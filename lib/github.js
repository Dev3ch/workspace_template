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
 * Escribe (o actualiza) las credenciales de GitHub en el archivo .claude-credentials
 * del proyecto indicado. El archivo se agrega a .gitignore automáticamente.
 *
 * @param {string} projectPath - directorio raíz del proyecto
 * @param {{ username: string, token: string }} creds
 */
export function saveProjectGithubCredentials(projectPath, { username, token, remote }) {
  const credsPath = path.join(projectPath, '.claude-credentials');

  // Leer contenido actual (si existe) para preservar claves no manejadas
  let lines = [];
  if (fs.existsSync(credsPath)) {
    lines = fs.readFileSync(credsPath, 'utf8').split('\n');
  }

  const updates = {
    GITHUB_USER: username,
    GH_TOKEN: token,
    GH_TOKEN_VERIFIED_AT: String(Math.floor(Date.now() / 1000)),
  };
  if (remote) updates.GH_TOKEN_REMOTE = remote;

  for (const [key, value] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    const line = `${key}=${value}`;
    if (idx >= 0) {
      lines[idx] = line;
    } else {
      lines.push(line);
    }
  }

  let output = lines.join('\n');
  if (!output.endsWith('\n')) output += '\n';
  fs.writeFileSync(credsPath, output, { mode: 0o600 });
  try { fs.chmodSync(credsPath, 0o600); } catch { /* Windows */ }

  // Asegurar que .claude-credentials esté en .gitignore
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gi = fs.readFileSync(gitignorePath, 'utf8');
    if (!gi.includes('.claude-credentials')) {
      fs.appendFileSync(gitignorePath, '\n.claude-credentials\n', 'utf8');
    }
  } else {
    fs.writeFileSync(gitignorePath, '.claude-credentials\n', 'utf8');
  }
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
 * Lee ~/.git-credentials y devuelve entradas que coincidan con el host dado.
 * @param {string} host  ej: 'github.com'
 * @returns {Array<{ username: string, token: string }>}
 */
function readGitCredentialsStore(host) {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const credFiles = [
    path.join(home, '.git-credentials'),
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'git', 'credentials'),
  ];
  const results = [];
  for (const file of credFiles) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      // Capturar solo hasta el primer / o fin de línea (el path no cuenta como host)
      const m = line.trim().match(/^https?:\/\/([^:]+):([^@]+)@([^/]+)/);
      if (m && m[3] === host) {
        results.push({ username: m[1], token: m[2] });
      }
    }
  }
  return results;
}

/**
 * Intenta resolver credenciales de GitHub desde un repo ya clonado,
 * sin pedirle nada al usuario. Busca en este orden:
 *
 *   1. URL del remote origin (si tiene user:token@ embebido)
 *   2. .claude-credentials del proyecto (GITHUB_USER + GH_TOKEN)
 *   3. .git/project-credentials (credential store del setup)
 *   4. ~/.git-credentials del sistema — cruza con el host del remote;
 *      si hay varias cuentas, valida cuál tiene push access al repo
 *   5. Sesión activa de gh CLI
 *   6. git config user.name local (solo usuario, sin token)
 *
 * @param {string} repoPath
 * @returns {{ username: string|null, token: string|null, source: string|null, hasRepoAccess: boolean|null }}
 */
export async function resolveCredsFromRepo(repoPath) {
  let username = null;
  let token = null;
  let source = null;

  // Obtener remote para cruzar con credential stores
  let remoteUrl = null;
  let remoteOwner = null;
  let remoteRepo = null;
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd: repoPath });
    remoteUrl = stdout.trim();
    const parsed = parseGithubUrl(remoteUrl);
    remoteOwner = parsed.owner;
    remoteRepo = parsed.repo;
  } catch { /* continúa */ }

  // 1. Remote URL con creds embebidas
  if (remoteUrl) {
    const extracted = extractCredsFromUrl(remoteUrl);
    if (extracted.username && extracted.token) {
      username = extracted.username;
      token = extracted.token;
      source = 'remote-url';
    }
  }

  // 2. .claude-credentials del proyecto
  if (!token) {
    const claudeCreds = path.join(repoPath, '.claude-credentials');
    if (fs.existsSync(claudeCreds)) {
      const content = fs.readFileSync(claudeCreds, 'utf8');
      const get = (key) => content.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim() ?? null;
      const u = get('GITHUB_USER');
      const t = get('GH_TOKEN');
      if (u && t) { username = u; token = t; source = '.claude-credentials'; }
    }
  }

  // 3. .git/project-credentials (credential store del setup)
  if (!token) {
    const credsFile = path.join(repoPath, '.git', 'project-credentials');
    if (fs.existsSync(credsFile)) {
      const m = fs.readFileSync(credsFile, 'utf8').trim().match(/^https?:\/\/([^:]+):([^@]+)@/);
      if (m) { username = m[1]; token = m[2]; source = 'project-credentials'; }
    }
  }

  // 4. ~/.git-credentials — la fuente más directa de "quién clonó"
  if (!token) {
    const stored = readGitCredentialsStore('github.com');
    if (stored.length === 1) {
      username = stored[0].username;
      token = stored[0].token;
      source = '~/.git-credentials';
    } else if (stored.length > 1 && remoteOwner && remoteRepo) {
      // Varias cuentas — verificar cuál tiene push access al repo
      for (const cred of stored) {
        try {
          const { stdout } = await execa('gh', ['api', `repos/${remoteOwner}/${remoteRepo}`, '--jq', '.permissions.push'], {
            env: { ...process.env, GH_TOKEN: cred.token },
          });
          if (stdout.trim() === 'true') {
            username = cred.username;
            token = cred.token;
            source = '~/.git-credentials';
            break;
          }
        } catch { /* esta cuenta no tiene acceso — probar la siguiente */ }
      }
    }
  }

  // 5. Sesión activa de gh CLI
  if (!token) {
    try {
      const { stdout: tokenOut } = await execa('gh', ['auth', 'token']);
      const ghToken = tokenOut.trim();
      if (ghToken) {
        const { stdout: ghUser } = await execa('gh', ['api', 'user', '--jq', '.login'], {
          env: { ...process.env, GH_TOKEN: ghToken },
        });
        username = ghUser.trim();
        token = ghToken;
        source = 'gh-auth';
      }
    } catch { /* gh no instalado o sin sesión */ }
  }

  // 6. Solo usuario desde git config local (sin token)
  if (!username) {
    try {
      const { stdout } = await execa('git', ['config', '--local', 'user.name'], { cwd: repoPath });
      const u = stdout.trim();
      if (u) { username = u; source = 'git-config'; }
    } catch { /* continúa */ }
  }

  if (!username && !token) return { username: null, token: null, source: null, hasRepoAccess: null };

  // Validar acceso al repo con el token encontrado
  let hasRepoAccess = null;
  if (token && remoteOwner && remoteRepo) {
    try {
      const { stdout } = await execa('gh', ['api', `repos/${remoteOwner}/${remoteRepo}`, '--jq', '.permissions.push'], {
        env: { ...process.env, GH_TOKEN: token },
      });
      hasRepoAccess = stdout.trim() === 'true';
    } catch { hasRepoAccess = null; }
  }

  return { username, token, source, hasRepoAccess };
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

/**
 * Obtiene el nombre de la branch default del remote origin.
 * Intenta con gh api, luego con git symbolic-ref, luego fallback a 'main'.
 * @param {string} repoPath
 * @param {{ owner?: string, repo?: string, token?: string }} [opts]
 * @returns {Promise<string>} nombre de la branch default (ej 'main', 'master')
 */
export async function getDefaultBranch(repoPath, { owner, repo, token } = {}) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;

  if (owner && repo) {
    try {
      const { stdout } = await execa('gh', [
        'api', `repos/${owner}/${repo}`, '--jq', '.default_branch',
      ], { env });
      const name = stdout.trim();
      if (name) return name;
    } catch { /* sigue con fallback */ }
  }

  try {
    const { stdout } = await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd: repoPath });
    const match = stdout.trim().match(/refs\/remotes\/origin\/(.+)$/);
    if (match) return match[1];
  } catch { /* sigue */ }

  return 'main';
}

/**
 * Verifica si una branch existe en el remote origin.
 * @param {string} repoPath
 * @param {string} branchName
 * @returns {Promise<boolean>}
 */
export async function remoteBranchExists(repoPath, branchName) {
  try {
    const { stdout } = await execa('git', ['ls-remote', '--heads', 'origin', branchName], { cwd: repoPath });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Renombra una branch en el remote vía GitHub API.
 * Requiere scope repo con permisos de admin sobre el repo.
 * @param {{ owner: string, repo: string, from: string, to: string, token?: string }} args
 * @returns {Promise<boolean>} true si se renombró correctamente
 */
export async function renameRemoteBranch({ owner, repo, from, to, token }) {
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  try {
    await execa('gh', [
      'api', '-X', 'POST',
      `repos/${owner}/${repo}/branches/${from}/rename`,
      '-f', `new_name=${to}`,
    ], { env });
    return true;
  } catch {
    return false;
  }
}

/**
 * Crea una branch en remote desde una base existente.
 * @param {string} repoPath
 * @param {{ name: string, from: string }} args
 * @returns {Promise<boolean>} true si la branch se creó y pusheó correctamente
 */
export async function createRemoteBranch(repoPath, { name, from }) {
  try {
    await execa('git', ['fetch', 'origin'], { cwd: repoPath });
    await execa('git', ['branch', name, `origin/${from}`], { cwd: repoPath });
    await execa('git', ['push', '-u', 'origin', name], { cwd: repoPath });
    return true;
  } catch {
    try {
      await execa('git', ['push', 'origin', `refs/remotes/origin/${from}:refs/heads/${name}`], { cwd: repoPath });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Normaliza el modelo de branches de un repo (main + dev, opcionalmente staging).
 *
 * Reglas:
 * - Si default es `master` y el usuario acepta, se renombra a `main`.
 *   Si falla el rename (permisos), se mantiene `master` como base — no bloquea.
 * - `dev` se crea sí o sí si no existe (desde la branch default).
 *   Si existe, se respeta tal cual.
 * - `staging` es opcional — se pregunta al usuario.
 *
 * No cambia la branch default del repo en GitHub — eso queda para el usuario.
 *
 * @param {string} repoPath
 * @param {{
 *   owner: string,
 *   repo: string,
 *   token?: string,
 *   promptRename: (from: string, to: string) => Promise<boolean>,
 *   promptStaging: () => Promise<boolean>,
 *   log?: (msg: string) => void,
 * }} opts
 * @returns {Promise<{
 *   defaultBranch: string,
 *   renamedMasterToMain: boolean,
 *   renameFailed: boolean,
 *   devCreated: boolean,
 *   devAlreadyExisted: boolean,
 *   stagingCreated: boolean,
 *   stagingAlreadyExisted: boolean,
 *   actions: string[],
 * }>}
 */
export async function ensureBranchModel(repoPath, {
  owner, repo, token, promptRename, promptStaging, log = () => {},
}) {
  const actions = [];
  const result = {
    defaultBranch: 'main',
    renamedMasterToMain: false,
    renameFailed: false,
    devCreated: false,
    devAlreadyExisted: false,
    stagingCreated: false,
    stagingAlreadyExisted: false,
    actions,
  };

  // 1. Refrescar referencias remotas antes de cualquier decisión
  try { await execa('git', ['fetch', 'origin'], { cwd: repoPath }); } catch { /* repo sin remoto aún */ }

  // 2. Detectar branch default
  let defaultBranch = await getDefaultBranch(repoPath, { owner, repo, token });
  result.defaultBranch = defaultBranch;

  // 3. Renombrar master → main (opcional, con confirmación)
  if (defaultBranch === 'master' && owner && repo) {
    const confirmRename = await promptRename('master', 'main');
    if (confirmRename) {
      const ok = await renameRemoteBranch({ owner, repo, from: 'master', to: 'main', token });
      if (ok) {
        try {
          await execa('git', ['fetch', 'origin'], { cwd: repoPath });
          await execa('git', ['remote', 'set-head', 'origin', 'main'], { cwd: repoPath });
          await execa('git', ['branch', '-m', 'master', 'main'], { cwd: repoPath });
          await execa('git', ['branch', '-u', 'origin/main', 'main'], { cwd: repoPath });
        } catch { /* local puede estar en otra branch */ }
        result.renamedMasterToMain = true;
        result.defaultBranch = 'main';
        defaultBranch = 'main';
        actions.push('master renombrada a main');
        log('master renombrada a main');
      } else {
        result.renameFailed = true;
        actions.push('rename master→main falló (permisos insuficientes) — se mantiene master');
        log('rename master→main falló — se mantiene master como base');
      }
    } else {
      actions.push('usuario eligió mantener master');
    }
  }

  // 4. Crear rama dev si no existe (obligatorio)
  const devExists = await remoteBranchExists(repoPath, 'dev');
  if (devExists) {
    result.devAlreadyExisted = true;
    actions.push('dev ya existe en remote');
    log('rama dev ya existe, se respeta tal cual');
  } else {
    const created = await createRemoteBranch(repoPath, { name: 'dev', from: defaultBranch });
    if (created) {
      result.devCreated = true;
      actions.push(`dev creada desde ${defaultBranch}`);
      log(`rama dev creada desde ${defaultBranch}`);
    } else {
      actions.push('no se pudo crear dev — verifica permisos de push');
      log('no se pudo crear dev — verifica permisos de push');
    }
  }

  // 5. Staging opcional (pregunta interactiva)
  const stagingExists = await remoteBranchExists(repoPath, 'staging');
  if (stagingExists) {
    result.stagingAlreadyExisted = true;
    actions.push('staging ya existe en remote');
  } else if (typeof promptStaging === 'function') {
    const wantStaging = await promptStaging();
    if (wantStaging) {
      const created = await createRemoteBranch(repoPath, { name: 'staging', from: defaultBranch });
      if (created) {
        result.stagingCreated = true;
        actions.push(`staging creada desde ${defaultBranch}`);
        log(`rama staging creada desde ${defaultBranch}`);
      } else {
        actions.push('no se pudo crear staging — verifica permisos de push');
      }
    }
  }

  return result;
}
