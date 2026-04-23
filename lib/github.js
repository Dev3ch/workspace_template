import { execa } from 'execa';
import ora from 'ora';

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
export async function createGithubProject(owner, title) {
  const spinner = ora(`Creando GitHub Project "${title}"...`).start();
  try {
    const { stdout } = await execa('gh', [
      'project', 'create',
      '--owner', owner,
      '--title', title,
      '--format', 'json',
    ]);
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
export async function getGithubProject(owner, number) {
  try {
    const { stdout } = await execa('gh', [
      'project', 'view', String(number),
      '--owner', owner,
      '--format', 'json',
    ]);
    const data = JSON.parse(stdout);
    return { url: data.url, number: data.number, title: data.title };
  } catch (err) {
    throw new Error(`gh project view falló: ${err.stderr ?? err.message}`);
  }
}

/**
 * Lista los GitHub Projects disponibles para un owner.
 * @param {string} owner
 * @returns {Array<{ number: number, title: string, url: string }>}
 */
export async function listGithubProjects(owner) {
  try {
    const { stdout } = await execa('gh', [
      'project', 'list',
      '--owner', owner,
      '--format', 'json',
    ]);
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
 * Clona un repositorio GitHub en el path indicado.
 * @param {string} repoUrl  - URL HTTPS o SSH del repo
 * @param {string} destPath - directorio destino
 */
export async function cloneRepo(repoUrl, destPath) {
  const spinner = ora(`Clonando ${repoUrl}...`).start();
  try {
    await execa('git', ['clone', repoUrl, destPath]);
    spinner.succeed(`Repositorio clonado en ${destPath}`);
  } catch (err) {
    spinner.fail(`Error al clonar ${repoUrl}`);
    throw new Error(`git clone falló: ${err.stderr ?? err.message}`);
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
