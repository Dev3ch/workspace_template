import { execa } from 'execa';
import ora from 'ora';
import fs from 'fs';
import path from 'path';

/**
 * Verifica si gh CLI está instalado en el sistema.
 * @returns {boolean}
 */
export async function isGhInstalled() {
  try {
    await execa('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifica si un GitHub token (Personal Access Token) es válido
 * llamando a la API sin depender de gh auth.
 * @param {string} token
 * @returns {{ valid: boolean, user: string|null }}
 */
export async function validateGithubToken(token) {
  try {
    const { stdout } = await execa('gh', ['api', 'user', '--jq', '.login'], {
      env: { ...process.env, GH_TOKEN: token },
    });
    return { valid: true, user: stdout.trim() };
  } catch {
    return { valid: false, user: null };
  }
}

/**
 * Valida un token usando curl (sin necesitar gh instalado).
 * @param {string} token
 * @returns {{ valid: boolean, user: string|null }}
 */
export async function validateTokenWithCurl(token) {
  try {
    const { stdout } = await execa('curl', [
      '-sf',
      '-H', `Authorization: token ${token}`,
      '-H', 'Accept: application/vnd.github.v3+json',
      'https://api.github.com/user',
    ]);
    const data = JSON.parse(stdout);
    return { valid: true, user: data.login ?? null };
  } catch {
    return { valid: false, user: null };
  }
}

/**
 * Escribe (o actualiza) las credenciales de GitHub en el archivo .env.local
 * del proyecto indicado. El archivo se agrega a .gitignore automáticamente.
 *
 * @param {string} projectPath - directorio raíz del proyecto
 * @param {{ username: string, token: string }} creds
 */
export function saveProjectGithubCredentials(projectPath, { username, token }) {
  const envLocalPath = path.join(projectPath, '.env.local');

  // Leer contenido actual (si existe)
  let lines = [];
  if (fs.existsSync(envLocalPath)) {
    lines = fs.readFileSync(envLocalPath, 'utf8').split('\n');
  }

  // Reemplazar o agregar cada clave
  const updates = { GITHUB_USER: username, GH_TOKEN: token };
  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    const line = `${key}=${value}`;
    if (idx >= 0) {
      lines[idx] = line;
    } else {
      lines.push(line);
    }
  }

  // Remover sólo el salto de línea vacío final duplicado, preservar comentarios y blank lines intermedias
  let output = lines.join('\n');
  if (!output.endsWith('\n')) output += '\n';
  fs.writeFileSync(envLocalPath, output, 'utf8');

  // Asegurar que .env.local esté en .gitignore
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gi = fs.readFileSync(gitignorePath, 'utf8');
    if (!gi.includes('.env.local')) {
      fs.appendFileSync(gitignorePath, '\n.env.local\n', 'utf8');
    }
  } else {
    fs.writeFileSync(gitignorePath, '.env.local\n', 'utf8');
  }
}

/**
 * Lee las credenciales de GitHub desde .env.local del proyecto.
 * @param {string} projectPath
 * @returns {{ username: string|null, token: string|null }}
 */
export function readProjectGithubCredentials(projectPath) {
  const envLocalPath = path.join(projectPath, '.env.local');
  if (!fs.existsSync(envLocalPath)) return { username: null, token: null };

  const content = fs.readFileSync(envLocalPath, 'utf8');
  const get = (key) => {
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match?.[1]?.trim() ?? null;
  };

  return { username: get('GITHUB_USER'), token: get('GH_TOKEN') };
}

/**
 * Reescribe el remote origin del repo con las creds embebidas en la URL,
 * solo en .git/config local (no afecta otros repos ni la config global).
 *
 * Si el remote ya tiene creds embebidas las reemplaza.
 * Si el remote es SSH lo deja tal cual (SSH usa keys, no tokens).
 *
 * @param {string} repoPath
 * @param {{ username: string, token: string }} creds
 * @returns {boolean} true si se actualizó, false si no aplica (SSH u otro)
 */
export async function setRepoRemoteWithCreds(repoPath, { username, token }) {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
    const currentUrl = stdout.trim();

    // Solo aplica a HTTPS — SSH usa keys y no se toca
    if (!currentUrl.startsWith('https://')) return false;

    // Quitar creds existentes si las hay, luego embeber las nuevas
    const { cleanUrl } = extractCredsFromUrl(currentUrl);
    const newUrl = cleanUrl.replace('https://', `https://${username}:${token}@`);

    await execa('git', ['remote', 'set-url', 'origin', newUrl], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Configura git user.name y user.email localmente en el repo.
 * @param {string} repoPath
 * @param {{ name: string, email?: string }} opts
 */
export async function setGitUserLocal(repoPath, { name, email }) {
  try {
    await execa('git', ['config', 'user.name', name], { cwd: repoPath });
    if (email) {
      await execa('git', ['config', 'user.email', email], { cwd: repoPath });
    }
  } catch {
    // no bloquea si no hay repo git
  }
}

/**
 * Verifica si el usuario está autenticado en gh CLI.
 * @returns {{ authenticated: boolean, user: string|null }}
 */
export async function checkGhAuth() {
  try {
    const { stdout } = await execa('gh', ['auth', 'status']);
    const userMatch = stdout.match(/Logged in to github\.com account (\S+)/);
    const user = userMatch?.[1] ?? null;
    return { authenticated: true, user };
  } catch (err) {
    // gh auth status imprime a stderr cuando no está autenticado
    const output = err.stderr ?? err.stdout ?? '';
    if (output.includes('not logged into')) {
      return { authenticated: false, user: null };
    }
    // Puede estar autenticado pero el output varía entre versiones
    try {
      const { stdout: out2 } = await execa('gh', ['api', 'user', '--jq', '.login']);
      return { authenticated: true, user: out2.trim() };
    } catch {
      return { authenticated: false, user: null };
    }
  }
}

/**
 * Muestra instrucciones detalladas para autenticarse con un
 * GitHub Personal Access Token cuando gh auth status falla.
 *
 * @param {import('chalk').ChalkInstance} chalk - instancia de chalk para colorear
 */
export function showGhAuthHelp(chalk) {
  console.log(chalk.bold.yellow('\nNecesitas autenticarte en GitHub CLI (gh)\n'));

  console.log(chalk.white('Necesitas un GitHub Personal Access Token con los siguientes scopes:'));
  console.log(chalk.cyan('  • repo') + chalk.gray('       — acceso a repositorios'));
  console.log(chalk.cyan('  • read:org') + chalk.gray('    — leer datos de la organización'));
  console.log(chalk.cyan('  • project') + chalk.gray('     — acceso a GitHub Projects\n'));

  console.log(chalk.bold('Opción A — Autenticación interactiva (recomendada):'));
  console.log(chalk.bold.white('  gh auth login'));
  console.log(chalk.gray('  Sigue las instrucciones: GitHub.com → HTTPS → Login with web browser\n'));

  console.log(chalk.bold('Opción B — Personal Access Token manual:'));
  console.log(chalk.gray('  1. Ve a: ') + chalk.cyan('https://github.com/settings/tokens/new'));
  console.log(chalk.gray('  2. Activa los scopes: repo, read:org, project'));
  console.log(chalk.gray('  3. Copia el token generado'));
  console.log(chalk.gray('  4. Ejecuta:'));
  console.log(chalk.bold.white('       gh auth login --with-token'));
  console.log(chalk.gray('     y pega el token cuando te lo pida\n'));

  console.log(chalk.bold('Clonar con token (evita configurar SSH keys):'));
  console.log(chalk.gray('  Formato de URL autenticada HTTPS:'));
  console.log(chalk.cyan('  https://<username>:<token>@github.com/<org>/<repo>.git'));
  console.log(chalk.gray('  Este formato funciona sin SSH y evita problemas de permisos.\n'));
}

/**
 * Crea un GitHub Project (Projects v2) para un owner dado.
 * @param {string} owner  - usuario u organización de GitHub
 * @param {string} title  - nombre del proyecto
 * @returns {{ url: string, number: number }}
 */
export async function createGithubProject(owner, title, token) {
  const spinner = ora(`Creando GitHub Project "${title}"...`).start();
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  try {
    const { stdout } = await execa('gh', [
      'project', 'create',
      '--owner', owner,
      '--title', title,
      '--format', 'json',
    ], { env });
    const data = JSON.parse(stdout);
    spinner.succeed(`GitHub Project creado: ${data.url}`);
    return { url: data.url, number: data.number };
  } catch (err) {
    spinner.fail('Error al crear GitHub Project');
    throw new Error(`gh project create falló: ${err.stderr ?? err.message}`);
  }
}

/**
 * Obtiene la info de un GitHub Project existente (por número).
 * @param {string} owner  - usuario u organización
 * @param {string|number} number - número del project (ej: 5)
 * @returns {{ url: string, number: number, title: string }}
 */
export async function getGithubProject(owner, number, token) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  try {
    const { stdout } = await execa('gh', [
      'project', 'view', String(number),
      '--owner', owner,
      '--format', 'json',
    ], { env });
    const data = JSON.parse(stdout);
    return { url: data.url, number: data.number, title: data.title };
  } catch (err) {
    throw new Error(`gh project view falló: ${err.stderr ?? err.message}`);
  }
}

/**
 * Lista los GitHub Projects disponibles para un owner.
 * @param {string} owner
 * @param {string} [token] - token opcional para el proyecto
 * @returns {Array<{ number: number, title: string, url: string }>}
 */
export async function listGithubProjects(owner, token) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  try {
    const { stdout } = await execa('gh', [
      'project', 'list',
      '--owner', owner,
      '--format', 'json',
    ], { env });
    const data = JSON.parse(stdout);
    return data.projects ?? [];
  } catch {
    return [];
  }
}

/**
 * Parsea un input que puede ser un número (ej "5") o una URL
 * de GitHub Project (ej "https://github.com/users/foo/projects/5")
 * y devuelve el número.
 * @param {string} input
 * @returns {number|null}
 */
export function parseProjectInput(input) {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const urlMatch = trimmed.match(/\/projects\/(\d+)/);
  if (urlMatch) return parseInt(urlMatch[1], 10);
  return null;
}

/**
 * Enmascara credenciales en una URL para mostrar en logs.
 * https://user:token@github.com/... → https://user:***@github.com/...
 * @param {string} url
 * @returns {string}
 */
export function maskUrlCreds(url) {
  return url.replace(/:([^@/]+)@/, ':***@');
}

/**
 * Clona un repositorio GitHub en el path indicado.
 * Si se provee un token, lo embebe en la URL HTTPS para autenticación por proyecto.
 * @param {string} repoUrl  - URL HTTPS o SSH del repo
 * @param {string} destPath - directorio destino
 * @param {{ username?: string, token?: string }} [creds] - credenciales opcionales por proyecto
 */
export async function cloneRepo(repoUrl, destPath, creds = {}) {
  const safeDisplay = maskUrlCreds(repoUrl);
  const spinner = ora(`Clonando ${safeDisplay}...`).start();

  let cloneUrl = repoUrl;
  if (creds.token && creds.username && /^https:\/\/github\.com/.test(repoUrl)) {
    cloneUrl = repoUrl.replace('https://', `https://${creds.username}:${creds.token}@`);
  }

  try {
    await execa('git', ['clone', cloneUrl, destPath]);
    spinner.succeed(`Repositorio clonado en ${destPath}`);
  } catch (err) {
    spinner.fail(`Error al clonar ${safeDisplay}`);
    const sanitizedErr = (err.stderr ?? err.message).replace(/:[^@/\s]+@/g, ':***@');
    throw new Error(`git clone falló: ${sanitizedErr}`);
  }
}

/**
 * Crea los issue templates en el repo especificado.
 * Los archivos deben ser generados antes con workspace-gen.js;
 * esta función sólo hace el commit + push.
 *
 * @param {string} repoPath - ruta local del repo
 * @param {string[]} files  - rutas relativas de los archivos a commitear
 */
export async function commitIssueTemplates(repoPath, files) {
  const spinner = ora('Commiteando issue templates...').start();
  try {
    for (const file of files) {
      await execa('git', ['add', file], { cwd: repoPath });
    }
    await execa('git', [
      'commit', '-m',
      'chore(github): add issue templates and PR template',
    ], { cwd: repoPath });
    spinner.succeed('Issue templates commiteados');
  } catch (err) {
    spinner.fail('Error al commitear issue templates');
    throw new Error(`git commit falló: ${err.stderr ?? err.message}`);
  }
}

/**
 * Obtiene el owner/org y el nombre del repo a partir de una URL de GitHub.
 * Soporta HTTPS y SSH.
 * @param {string} url
 * @returns {{ owner: string, repo: string }}
 */
export function parseGithubUrl(url) {
  // HTTPS: https://github.com/owner/repo.git
  // HTTPS con creds: https://user:token@github.com/owner/repo.git
  // SSH:   git@github.com:owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  const match = httpsMatch ?? sshMatch;
  if (!match) {
    throw new Error(`No se pudo parsear la URL de GitHub: ${url}`);
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Si la URL HTTPS tiene credenciales embebidas (user:token@),
 * las extrae y devuelve la URL limpia + las credenciales.
 * Si no tiene credenciales, devuelve la URL tal cual con nulls.
 *
 * @param {string} url
 * @returns {{ cleanUrl: string, username: string|null, token: string|null }}
 */
export function extractCredsFromUrl(url) {
  const match = url.match(/^(https?:\/\/)([^:]+):([^@]+)@(.+)$/);
  if (!match) return { cleanUrl: url, username: null, token: null };
  return {
    cleanUrl: `${match[1]}${match[4]}`,
    username: match[2],
    token: match[3],
  };
}

/**
 * Verifica si un path es un repositorio git (tiene carpeta .git o archivo .git para worktrees).
 * @param {string} repoPath
 * @returns {boolean}
 */
export function isGitRepo(repoPath) {
  const gitPath = path.join(repoPath, '.git');
  return fs.existsSync(gitPath);
}

/**
 * Obtiene el remote origin de un repo local.
 * @param {string} repoPath
 * @returns {string|null}
 */
export async function getRemoteOrigin(repoPath) {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
    return stdout.trim();
  } catch {
    return null;
  }
}
