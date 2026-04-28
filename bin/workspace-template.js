#!/usr/bin/env node
/**
 * workspace-template — CLI para configurar un workspace de Claude Code
 * Uso: node bin/workspace-template.js  |  npx workspace-template  |  ./setup.sh
 */

import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import {
  input,
  select,
  confirm,
  checkbox,
} from '@inquirer/prompts';
import { execa } from 'execa';

import { checkEnvironment } from '../lib/detect-env.js';
import { detectStacks, detectPort } from '../lib/stack-detect.js';
import { showInstallInstructions, showPresentTools } from '../lib/installer.js';
import { runEnvBootstrap } from '../lib/env-bootstrap.js';
import {
  checkGhAuth,
  isGhInstalled,
  validateGithubToken,
  validateTokenWithCurl,
  saveProjectGithubCredentials,
  ensureClaudeCredentialsIgnored,
  setGitUserLocal,
  cloneRepo,
  createGithubProject,
  getGithubProject,
  listGithubProjects,
  parseGithubUrl,
  parseProjectInput,
  getRemoteOrigin,
  showGhAuthHelp,
  extractCredsFromUrl,
  setRepoRemoteWithCreds,
  isGitRepo,
  resolveCredsFromRepo,
  ensureBranchModel,
} from '../lib/github.js';
import {
  generateClaudeDir,
  generateMultiRepoCLAUDE,
  generateSingleRepoCLAUDE,
  generateIssueTemplates,
  printGeneratedTree,
} from '../lib/workspace-gen.js';
import { mergeMcpConfig } from '../lib/mcp-tools.js';
import { runUpdate, getCurrentPackageVersion, saveGithubProject } from '../lib/updater.js';

// ──────────────────────────────────────────────────────────────
// CLEANUP — estado de recursos creados por el setup
// ──────────────────────────────────────────────────────────────

/**
 * Tracker de directorios creados por el setup. Si el usuario cancela,
 * se pueden limpiar los directorios parciales (clones incompletos,
 * carpetas recién creadas) sin tocar nada preexistente.
 */
const createdResources = {
  dirs: new Set(),    // directorios creados por nosotros (candidatos a limpiar)
  abortRequested: false,
};

function trackCreatedDir(dirPath) {
  createdResources.dirs.add(path.resolve(dirPath));
}

async function cleanupPartialState() {
  if (createdResources.dirs.size === 0) return;
  console.log(chalk.yellow('\n⚠  Limpiando recursos parciales...'));
  for (const dir of createdResources.dirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(chalk.gray(`  → eliminado: ${dir}`));
      }
    } catch (err) {
      console.log(chalk.red(`  ✗ no se pudo eliminar ${dir}: ${err.message}`));
    }
  }
}

// Captura Ctrl+C global — limpia recursos parciales y sale
process.on('SIGINT', async () => {
  if (createdResources.abortRequested) {
    // Doble Ctrl+C — salida dura
    process.exit(130);
  }
  createdResources.abortRequested = true;
  console.log(chalk.yellow('\n\n⚠  Ctrl+C detectado — cancelando setup...'));
  await cleanupPartialState();
  console.log(chalk.yellow('Saliendo.\n'));
  process.exit(130);
});

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────

/** Espera a que el usuario presione Enter */
async function pressEnter(msg = 'Presiona Enter para continuar...') {
  await input({ message: chalk.gray(msg), default: '' });
}

/** Mapeo de valor de stack a label legible */
const STACK_LABELS = {
  nextjs:         'Next.js / React',
  vue:            'Vue / Nuxt',
  django:         'Django / Python',
  fastapi:        'FastAPI / Python',
  'react-native': 'React Native',
  flutter:        'Flutter',
  go:             'Go',
  other:          'Otro (texto libre)',
};

/** Templates oficiales de Dev3ch por stack (clonados cuando se inicia desde cero) */
const STACK_TEMPLATES = {
  nextjs:  'https://github.com/Dev3ch/react_template',
  vue:     null,
  django:  'https://github.com/Dev3ch/django_template',
  fastapi: null,
  'react-native': 'https://github.com/Dev3ch/react_template',
  flutter: 'https://github.com/Dev3ch/flutter_template',
  go:      'https://github.com/Dev3ch/go_template',
};

/** Elige uno o varios stacks para un repo */
async function askStacks(repoName) {
  const choices = Object.entries(STACK_LABELS).map(([value, name]) => ({ name, value }));
  const selected = await checkbox({
    message: `¿Qué stack(s) usa "${repoName}"?`,
    choices,
    validate: (v) => v.length > 0 || 'Selecciona al menos un stack',
  });

  const stacks = [];
  for (const s of selected) {
    if (s === 'other') {
      const custom = await input({ message: 'Especifica el stack (ej: Rails, Laravel):' });
      stacks.push(custom.trim().toLowerCase().replace(/\s+/g, '-'));
    } else {
      stacks.push(s);
    }
  }
  return stacks;
}

/** Genera el label de stack para la tabla de repos */
function stackLabel(stacks) {
  return stacks.map((s) => STACK_LABELS[s] ?? s).join(' + ');
}

/**
 * Resuelve los stacks de un repo existente: intenta auto-detectar primero
 * leyendo manifests (package.json, pyproject.toml, go.mod, etc).
 * Si detecta algo, muestra al usuario y pregunta si confirmar o ajustar.
 * Si no detecta nada, cae al flujo manual (askStacks).
 *
 * @param {string} repoPath
 * @param {string} repoName
 * @returns {string[]}
 */
async function resolveStacks(repoPath, repoName) {
  const { stacks: detected, evidence } = detectStacks(repoPath);

  if (detected.length === 0) {
    console.log(chalk.gray(`  → No se detectaron stacks automáticamente en "${repoName}"`));
    return askStacks(repoName);
  }

  const labels = detected.map((s) => STACK_LABELS[s] ?? s).join(', ');
  console.log(chalk.green(`  ✓ Stacks detectados en "${repoName}": ${chalk.bold(labels)}`));
  for (const s of detected) {
    console.log(chalk.gray(`      ${s} → ${evidence[s].join(', ')}`));
  }

  const action = await select({
    message: '¿Qué hacer con los stacks detectados?',
    choices: [
      { name: 'Usarlos tal cual (recomendado)',           value: 'keep' },
      { name: 'Agregar o quitar alguno manualmente',      value: 'edit' },
    ],
  });

  if (action === 'keep') return detected;
  return askStacks(repoName);
}

/**
 * Pide una lista de repos en batch: el usuario pega URLs o rutas locales,
 * una por línea. Devuelve objetos normalizados {kind, value}.
 *
 * kind: 'url' si es URL GitHub, 'path' si es ruta local, 'unknown' si no se pudo.
 */
async function askReposBatch() {
  console.log(chalk.gray('Pega las URLs de GitHub o rutas locales de tus repos, una por línea.'));
  console.log(chalk.gray('Puedes mezclar URLs y rutas. Cuando termines, deja una línea vacía y presiona Enter.\n'));

  const entries = [];
  let lineNum = 1;

  while (true) {
    const line = await input({
      message: `Repo ${lineNum} (URL o ruta, vacío para terminar):`,
    });
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (entries.length === 0) {
        console.log(chalk.yellow('⚠  Agrega al menos un repo.'));
        continue;
      }
      break;
    }

    // Detectar si es URL o ruta
    if (/^(https?:\/\/|git@)/.test(trimmed)) {
      entries.push({ kind: 'url', value: trimmed });
    } else if (fs.existsSync(trimmed)) {
      entries.push({ kind: 'path', value: path.resolve(trimmed) });
    } else {
      console.log(chalk.yellow(`  ⚠  "${trimmed}" no es URL válida ni ruta existente — se ignora`));
      continue;
    }

    lineNum++;
  }

  return entries;
}

/**
 * Normaliza el modelo de branches de un repo (main + dev, staging opcional).
 * Pensado para invocarse después de que el remote está configurado con creds del proyecto.
 *
 * @param {string} repoPath
 * @param {{ owner: string, repo: string, token?: string, label?: string }} opts
 */
async function normalizeRepoBranches(repoPath, { owner, repo, token, label }) {
  const prefix = label ? chalk.gray(`  [${label}] `) : chalk.gray('  ');
  const spinner = ora(`${label ? `[${label}] ` : ''}Verificando modelo de branches...`).start();

  try {
    const report = await ensureBranchModel(repoPath, {
      owner,
      repo,
      token,
      promptRename: async (from, to) => {
        spinner.stop();
        const answer = await confirm({
          message: `El repo "${repo}" usa "${from}" como branch principal. El estándar es "${to}". ¿Renombrar?`,
          default: true,
        });
        spinner.start('Aplicando cambios de branches...');
        return answer;
      },
      promptStaging: async () => {
        spinner.stop();
        console.log(chalk.gray(`${prefix}staging es opcional — útil para flujos con QA antes de producción.`));
        const answer = await confirm({
          message: `¿Crear también la rama "staging" en "${repo}"?`,
          default: false,
        });
        spinner.start('Aplicando cambios de branches...');
        return answer;
      },
    });

    spinner.succeed(`${label ? `[${label}] ` : ''}Modelo de branches OK — default: ${chalk.bold(report.defaultBranch)}`);

    if (report.renamedMasterToMain) console.log(chalk.green(`${prefix}✓ master renombrada a main`));
    if (report.renameFailed)         console.log(chalk.yellow(`${prefix}⚠  no se pudo renombrar master (permisos) — se mantiene como base`));
    if (report.devCreated)           console.log(chalk.green(`${prefix}✓ rama dev creada desde ${report.defaultBranch}`));
    if (report.devAlreadyExisted)    console.log(chalk.gray(`${prefix}→ rama dev ya existía — se respeta`));
    if (report.stagingCreated)       console.log(chalk.green(`${prefix}✓ rama staging creada desde ${report.defaultBranch}`));
    if (report.stagingAlreadyExisted) console.log(chalk.gray(`${prefix}→ rama staging ya existía`));

    // Posicionar en dev para que todos los commits del setup queden en dev, nunca en main
    try {
      await execa('git', ['checkout', 'dev'], { cwd: repoPath });
      console.log(chalk.green(`${prefix}✓ Posicionado en dev — los commits del setup irán a dev`));
    } catch {
      console.log(chalk.yellow(`${prefix}⚠  No se pudo hacer checkout a dev — verifica manualmente`));
    }

    return report;
  } catch (err) {
    spinner.fail(`${label ? `[${label}] ` : ''}No se pudo normalizar branches: ${err.message}`);
    console.log(chalk.gray(`${prefix}El repo queda tal cual — puedes correr /branches después para normalizarlo.`));
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// PASO 1 — Verificación del entorno
// ──────────────────────────────────────────────────────────────

async function stepEnvCheck() {
  console.log(chalk.bold.cyan('\n═══ Paso 1 — Verificando entorno ═══\n'));

  const { os: detectedOS, wantsToContinue } = await runEnvBootstrap();

  if (!wantsToContinue) {
    console.log(chalk.yellow('\nSetup cancelado. Instala las herramientas faltantes y vuelve a ejecutar.\n'));
    process.exit(0);
  }

  return detectedOS;
}

// ──────────────────────────────────────────────────────────────
// PASO 2 — GitHub Token / Auth
// ──────────────────────────────────────────────────────────────

/**
 * Valida un token ya obtenido (ej: extraído de una URL) antes de usarlo.
 * Si es inválido, ofrece reingresar uno. Devuelve { username, token } válidos
 * o null si el usuario decide continuar sin token.
 *
 * @param {string} token
 * @param {string|null} expectedUsername - opcional, para advertir si cambia
 * @returns {{ username: string, token: string } | null}
 */
async function preflightTokenValidation(token, expectedUsername = null) {
  const ghAvailable = await isGhInstalled();
  const spinner = ora('Validando token...').start();
  const result = ghAvailable
    ? await validateGithubToken(token)
    : await validateTokenWithCurl(token);

  if (result.valid) {
    spinner.succeed(`Token válido — cuenta: ${chalk.bold(result.user)}`);
    if (expectedUsername && result.user.toLowerCase() !== expectedUsername.toLowerCase()) {
      console.log(chalk.yellow(`  ⚠  El token pertenece a "${result.user}" pero el username esperado era "${expectedUsername}"`));
    }
    return { username: result.user, token };
  }

  spinner.fail('Token inválido o expirado');
  const retry = await confirm({
    message: '¿Ingresar un token nuevo?',
    default: true,
  });
  if (!retry) return null;

  return await askAndValidateToken(ghAvailable);
}

/**
 * Pide y valida un GitHub Personal Access Token.
 * Si gh está disponible lo valida con la API; si no, usa curl.
 * @param {boolean} ghAvailable
 * @returns {{ username: string, token: string }}
 */
async function askAndValidateToken(ghAvailable) {
  console.log(chalk.gray('\nNecesitas un GitHub Personal Access Token con scopes: repo, read:org, project'));
  console.log(chalk.cyan('  Créalo en: https://github.com/settings/tokens/new\n'));

  while (true) {
    const token = await input({
      message: 'Pega tu GitHub Personal Access Token (ghp_...):',
      validate: (v) => v.trim().length > 10 || 'El token parece inválido',
    });

    const trimmed = token.trim();
    const spinner = ora('Validando token...').start();

    const result = ghAvailable
      ? await validateGithubToken(trimmed)
      : await validateTokenWithCurl(trimmed);

    if (result.valid) {
      spinner.succeed(`Token válido — cuenta: ${chalk.bold(result.user)}`);
      return { username: result.user, token: trimmed };
    } else {
      spinner.fail('Token inválido o sin permisos suficientes. Intenta de nuevo.');
    }
  }
}

async function stepGithubAuth() {
  console.log(chalk.bold.cyan('═══ Paso 2 — Autenticación GitHub ═══\n'));

  // Si ya estamos dentro de un repo clonado, intentar resolver creds sin preguntar
  const cwd = process.cwd();
  if (isGitRepo(cwd)) {
    const resolved = await resolveCredsFromRepo(cwd);
    if (resolved.username && resolved.token) {
      if (resolved.hasRepoAccess === false) {
        console.log(chalk.red(`✗ Usuario "${resolved.username}" detectado (${resolved.source}) pero NO tiene acceso de escritura al repo.`));
        console.log(chalk.yellow('  Es posible que no hayas sido invitado al repositorio.'));
        console.log(chalk.gray('  Puedes continuar con otro token o salir.\n'));
        // No retornar — caer al flujo interactivo para que ingrese otro token
      } else {
        const accessMsg = resolved.hasRepoAccess === true ? chalk.green(' ✓ acceso verificado') : chalk.gray(' (acceso no verificado)');
        console.log(chalk.green(`✓ Credenciales detectadas desde el repo (${resolved.source})${accessMsg}`));
        console.log(chalk.gray(`  Usuario: ${chalk.bold(resolved.username)}\n`));
        return { ghUser: resolved.username, projectToken: resolved.token };
      }
    } else if (resolved.username) {
      console.log(chalk.gray(`  → Usuario local detectado: ${chalk.bold(resolved.username)} (sin token — se pedirá si es necesario)\n`));
    }
  }

  const ghInstalled = await isGhInstalled();

  if (ghInstalled) {
    // gh está instalado — verificar si ya hay sesión activa
    const { authenticated, user } = await checkGhAuth();

    if (authenticated) {
      console.log(chalk.green(`✓ gh CLI detectado — sesión activa: ${chalk.bold(user)}`));
      console.log(chalk.gray('  Opción A: usar esta sesión global (no crea .claude-credentials, usa config del sistema)'));
      console.log(chalk.gray('  Opción B: token por proyecto (aísla credenciales en .claude-credentials, no toca tu sesión global)\n'));

      const useExisting = await confirm({
        message: `¿Usar la cuenta global "${user}" para este proyecto?`,
        default: true,
      });

      if (useExisting) {
        console.log(chalk.green(`✓ Usando cuenta global: ${chalk.bold(user)}\n`));
        // Sin token de proyecto — se usará la sesión global de gh
        return { ghUser: user, projectToken: null };
      }
    } else {
      console.log(chalk.yellow('⚠  gh CLI instalado pero sin sesión activa.'));
    }

    // Quiere configurar cuenta diferente (o no hay sesión)
    console.log(chalk.bold('\n¿Cómo quieres configurar GitHub para este proyecto?\n'));
    const authMode = await select({
      message: 'Modo de autenticación:',
      choices: [
        { name: 'Token por proyecto  (recomendado — solo aplica a este proyecto)', value: 'project-token' },
        { name: 'gh auth login       (cambia la sesión global de gh CLI)',          value: 'gh-login' },
      ],
    });

    if (authMode === 'gh-login') {
      showGhAuthHelp(chalk);
      await pressEnter('Cuando hayas completado gh auth login, presiona Enter...');
      const result = await checkGhAuth();
      if (!result.authenticated) {
        console.log(chalk.red('✗ Aún no autenticado. Abortando.'));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Autenticado globalmente como: ${chalk.bold(result.user)}\n`));
      return { ghUser: result.user, projectToken: null };
    }

    // project-token
    const creds = await askAndValidateToken(true);
    return { ghUser: creds.username, projectToken: creds.token };

  } else {
    // gh NO está instalado
    console.log(chalk.yellow('⚠  gh CLI no está instalado en este sistema.\n'));

    const installChoice = await select({
      message: '¿Qué quieres hacer?',
      choices: [
        { name: 'Configurar solo para este proyecto (con token — no instala nada)',    value: 'project-token' },
        { name: 'Instalar gh CLI globalmente y luego autenticarme',                    value: 'install-gh' },
      ],
    });

    if (installChoice === 'install-gh') {
      console.log(chalk.bold('\nInstala gh CLI desde: ') + chalk.cyan('https://cli.github.com/'));
      console.log(chalk.gray('  Linux:   sudo apt install gh  |  brew install gh'));
      console.log(chalk.gray('  Windows: winget install GitHub.cli\n'));
      await pressEnter('Cuando hayas instalado y ejecutado gh auth login, presiona Enter...');

      const nowInstalled = await isGhInstalled();
      if (!nowInstalled) {
        console.log(chalk.red('✗ gh CLI aún no detectado. Continuando solo con token de proyecto.'));
      } else {
        const result = await checkGhAuth();
        if (result.authenticated) {
          console.log(chalk.green(`✓ gh CLI listo — autenticado como: ${chalk.bold(result.user)}\n`));
          return { ghUser: result.user, projectToken: null };
        }
        console.log(chalk.yellow('⚠  gh instalado pero sin sesión. Configura con token de proyecto.'));
      }
    }

    // project-token (sin gh)
    const creds = await askAndValidateToken(false);
    return { ghUser: creds.username, projectToken: creds.token };
  }
}

// ──────────────────────────────────────────────────────────────
// PASO 3 — Tipo de proyecto
// ──────────────────────────────────────────────────────────────

async function stepProjectType() {
  console.log(chalk.bold.cyan('═══ Paso 3 — Tipo de proyecto ═══\n'));

  const projectType = await select({
    message: '¿Cómo es tu proyecto?',
    choices: [
      {
        name: 'single-repo — un solo repositorio',
        value: 'single',
      },
      {
        name: 'multi-repo — varios repositorios agrupados en una carpeta workspace',
        value: 'multi',
      },
    ],
  });

  return projectType;
}

// ──────────────────────────────────────────────────────────────
// PASO 4a — Single repo
// ──────────────────────────────────────────────────────────────

async function stepSingleRepo(ghUser, { selectedSkills, mcpConfig, projectToken, projectSummary } = {}) {
  console.log(chalk.bold.cyan('\n═══ Paso 4 — Configuración single-repo ═══\n'));

  const repoOrigin = await select({
    message: '¿Cómo está tu proyecto?',
    choices: [
      { name: 'Ya tengo repo en GitHub (o SSH)',       value: 'github' },
      { name: 'Ya tengo carpeta local (sin GitHub)',    value: 'local' },
      { name: 'Empiezo desde cero',                     value: 'scratch' },
    ],
  });

  let repoPath;
  let owner;
  let repoName;

  if (repoOrigin === 'github') {
    const repoUrl = await input({
      message: 'URL del repositorio GitHub (HTTPS o SSH):',
      validate: (v) => v.trim().length > 0 || 'La URL no puede estar vacía',
    });

    const destParent = await input({
      message: 'Directorio donde clonar:',
      default: process.cwd(),
    });

    try {
      // Extraer creds embebidas si la URL tiene formato user:token@github.com
      const { cleanUrl, username: urlUser, token: urlToken } = extractCredsFromUrl(repoUrl.trim());
      if (urlUser && urlToken) {
        console.log(chalk.gray(`  → Credenciales detectadas en la URL — validando...`));
        const validated = await preflightTokenValidation(urlToken, urlUser);
        if (validated) {
          ghUser = validated.username;
          projectToken = validated.token;
          console.log(chalk.green(`✓ Usando credenciales del token — usuario: ${chalk.bold(ghUser)}`));
        } else {
          console.log(chalk.yellow('  ⚠  Continuando sin credenciales extraídas — el clone podría fallar si el repo es privado'));
        }
      }

      const parsed = parseGithubUrl(cleanUrl);
      owner = parsed.owner;
      repoName = parsed.repo;
      repoPath = path.join(path.resolve(destParent.trim()), repoName);
      if (fs.existsSync(repoPath)) {
        console.log(chalk.gray(`  → Ya existe localmente en ${repoPath} — se usa tal cual`));
      } else {
        trackCreatedDir(repoPath);
        await cloneRepo(cleanUrl, repoPath, { username: ghUser, token: projectToken });
      }

      // Fijar remote local con creds del proyecto (sin tocar config global)
      if (projectToken) {
        const updated = await setRepoRemoteWithCreds(repoPath, { username: ghUser, token: projectToken });
        if (updated) console.log(chalk.gray(`  → Remote origin actualizado con credenciales del proyecto`));
        await setGitUserLocal(repoPath, { name: ghUser });
      }

      // Normalizar modelo de branches (main + dev obligatorio, staging opcional)
      await normalizeRepoBranches(repoPath, { owner, repo: repoName, token: projectToken });
    } catch (err) {
      console.log(chalk.red(`✗ ${err.message}`));
      process.exit(1);
    }

  } else if (repoOrigin === 'local') {
    repoPath = await input({
      message: 'Ruta local del repositorio (absoluta):',
      validate: (v) => {
        const p = v.trim();
        return (p.length > 0 && fs.existsSync(p)) || `La ruta no existe: ${p}`;
      },
    });
    repoPath = path.resolve(repoPath.trim());

    // Validar que el path sea un repo git inicializado
    if (!isGitRepo(repoPath)) {
      console.log(chalk.yellow(`⚠  "${repoPath}" existe pero no es un repositorio git (no tiene .git/).`));
      const initNow = await confirm({
        message: '¿Inicializar git en esta carpeta?',
        default: false,
      });
      if (initNow) {
        await execa('git', ['init'], { cwd: repoPath });
        console.log(chalk.green(`✓ git init ejecutado en ${repoPath}`));
      } else {
        console.log(chalk.red('✗ Abortando — no se puede configurar workspace sin repo git.'));
        process.exit(1);
      }
    }

    const remoteUrl = await getRemoteOrigin(repoPath);
    if (remoteUrl) {
      try {
        const parsed = parseGithubUrl(remoteUrl);
        owner = parsed.owner;
        repoName = parsed.repo;
        console.log(chalk.gray(`  → Detectado: ${owner}/${repoName}`));

        // Detectar conflicto: el remote pertenece a un owner distinto al usuario actual
        // y no tenemos token de proyecto para resolverlo
        if (!projectToken && owner.toLowerCase() !== ghUser?.toLowerCase()) {
          console.log(chalk.yellow(
            `\n  ⚠  El remote origin pertenece a "${owner}" pero tu sesión activa es "${ghUser}".`
          ));
          console.log(chalk.gray('  Para hacer push/pull correctamente necesitas un token de esa cuenta.\n'));

          const wantsToken = await confirm({
            message: `¿Quieres ingresar un token para "${owner}" ahora?`,
            default: true,
          });

          if (wantsToken) {
            const ghInstalled = await isGhInstalled();
            const creds = await askAndValidateToken(ghInstalled);
            projectToken = creds.token;
            ghUser = creds.username;
          } else {
            console.log(chalk.yellow('  ⚠  Continuando sin reconfigurar — push/pull puede fallar si las cuentas no coinciden.'));
          }
        }
      } catch {
        console.log(chalk.yellow('  ⚠  No se detectó remote de GitHub — te pediré el owner y repo manualmente'));
      }
    } else {
      console.log(chalk.yellow('  ⚠  No se detectó remote de GitHub — te pediré el owner y repo manualmente'));
    }

    // Sobrescribir remote con creds del proyecto para evitar conflicto con cuenta global
    if (projectToken) {
      const updated = await setRepoRemoteWithCreds(repoPath, { username: ghUser, token: projectToken });
      if (updated) console.log(chalk.gray(`  → Remote origin reconfigurado con credenciales del proyecto`));
      await setGitUserLocal(repoPath, { name: ghUser });
    }

    // Normalizar modelo de branches (main + dev obligatorio, staging opcional)
    if (owner && repoName) {
      await normalizeRepoBranches(repoPath, { owner, repo: repoName, token: projectToken });
    }

  } else {
    // desde cero
    const destParent = await input({
      message: 'Directorio donde crear el proyecto:',
      default: process.cwd(),
      validate: (v) => fs.existsSync(path.resolve(v.trim())) || `No existe: ${v}`,
    });

    owner = await input({
      message: 'GitHub owner o org (para crear el repo):',
      default: ghUser ?? '',
      validate: (v) => v.trim().length > 0 || 'Requerido',
    });

    const newRepoName = await input({
      message: 'Nombre del nuevo repositorio:',
      validate: (v) => v.trim().length > 0 || 'El nombre no puede estar vacío',
    });
    repoName = newRepoName.trim().toLowerCase().replace(/\s+/g, '-');
    repoPath = path.join(path.resolve(destParent.trim()), repoName);

    // Elegir stack antes para saber si hay template
    const stacks = await askStacks(repoName);
    const primaryStack = stacks[0];
    const templateUrl = STACK_TEMPLATES[primaryStack] ?? null;

    const spinnerInit = ora('Inicializando proyecto...').start();
    try {
      trackCreatedDir(repoPath);
      if (templateUrl) {
        // Clonar template y desconectar del remote original
        await execa('git', ['clone', templateUrl, repoPath]);
        await execa('git', ['remote', 'remove', 'origin'], { cwd: repoPath });
        spinnerInit.succeed(`Template ${primaryStack} clonado en ${repoPath}`);
      } else {
        fs.mkdirSync(repoPath, { recursive: true });
        await execa('git', ['init'], { cwd: repoPath });
        spinnerInit.succeed(`Carpeta creada e inicializada: ${repoPath}`);
      }

      // Crear repo en GitHub y conectarlo
      const repoSpinner = ora(`Creando repo ${owner}/${repoName} en GitHub...`).start();
      try {
        const ghEnv = projectToken ? { ...process.env, GH_TOKEN: projectToken } : process.env;
        await execa('gh', ['repo', 'create', `${owner}/${repoName}`, '--private', '--source', repoPath, '--remote', 'origin'], { env: ghEnv });
        repoSpinner.succeed(`Repo creado: https://github.com/${owner}/${repoName}`);

        // Reescribir remote con creds para que push/pull no usen cuenta global
        if (projectToken) {
          await setRepoRemoteWithCreds(repoPath, { username: ghUser, token: projectToken });
          await setGitUserLocal(repoPath, { name: ghUser });
          console.log(chalk.gray(`  → Remote origin configurado con credenciales del proyecto`));
        }
      } catch (err) {
        repoSpinner.fail(`No se pudo crear el repo en GitHub: ${err.stderr ?? err.message}`);
        console.log(chalk.gray('  Puedes crearlo después con: gh repo create'));
      }

      // Retornar con stacks ya elegidos — generar config abajo
      const port = await input({ message: 'Puerto local (ej: 3000, 8000). Enter para omitir:', default: '' });

      const spinnerGen = ora('Generando CLAUDE.md y estructura .claude/...').start();
      generateSingleRepoCLAUDE(repoPath, {
        projectName: repoName,
        projectDescription: projectSummary ?? repoName,
        stack: stackLabel(stacks),
        port: port.trim() || 'N/A',
        owner: owner.trim(),
        repoName,
      });
      generateClaudeDir(repoPath, stacks, { selectedSkills, mcpConfig });
      generateIssueTemplates(repoPath);
      ensureClaudeCredentialsIgnored(repoPath);
      spinnerGen.succeed('Estructura generada');

      try {
        // Primer push en main (necesario para poder crear dev desde ahí)
        await execa('git', ['add', '.'], { cwd: repoPath });
        await execa('git', ['commit', '-m', 'chore(setup): initial commit'], { cwd: repoPath });
        await execa('git', ['push', '-u', 'origin', 'HEAD'], { cwd: repoPath });
        console.log(chalk.green('✓ Primer commit pusheado en main'));

        // Crear dev (y hacer checkout a dev)
        await normalizeRepoBranches(repoPath, { owner: owner.trim(), repo: repoName, token: projectToken });

        // Commit de la config de Claude Code en dev
        await execa('git', ['add', '.github/', '.claude/', 'CLAUDE.md'], { cwd: repoPath });
        await execa('git', ['commit', '-m', 'chore(setup): add Claude Code workspace config and GitHub templates'], { cwd: repoPath });
        await execa('git', ['push', '-u', 'origin', 'dev'], { cwd: repoPath });
        console.log(chalk.green('✓ Config de Claude Code commiteada en dev'));
      } catch {
        console.log(chalk.yellow('⚠  No se pudo hacer el primer push. Hazlo manualmente.'));
      }

      return { repoPath, owner: owner.trim(), repoName };
    } catch (err) {
      spinnerInit.fail(`Error: ${err.message}`);
      process.exit(1);
    }
  }

  if (!owner) {
    owner = await input({
      message: 'GitHub owner o org:',
      default: ghUser ?? '',
    });
  }
  if (!repoName) {
    repoName = await input({
      message: 'Nombre del repositorio GitHub:',
      validate: (v) => v.trim().length > 0 || 'Requerido',
    });
  }

  // Auto-detectar puerto del proyecto existente (docker-compose, .env*)
  const detectedPort = detectPort(repoPath);
  const port = await input({
    message: 'Puerto local (ej: 3000, 8000). Enter para omitir:',
    default: detectedPort ?? '',
  });

  // Auto-detectar stacks del repo existente (package.json, pyproject.toml, go.mod, ...)
  const stacks = await resolveStacks(repoPath, repoName);

  // Generar archivos
  const spinner = ora('Generando CLAUDE.md y estructura .claude/...').start();
  try {
    generateSingleRepoCLAUDE(repoPath, {
      projectName: repoName,
      projectDescription: projectSummary ?? repoName,
      stack: stackLabel(stacks),
      port: port.trim() || 'N/A',
      owner: owner.trim(),
      repoName: repoName.trim(),
    });
    generateClaudeDir(repoPath, stacks, { selectedSkills, mcpConfig });
    const templateFiles = generateIssueTemplates(repoPath);
    ensureClaudeCredentialsIgnored(repoPath);
    spinner.succeed('Estructura generada');

    // Intentar commitear issue templates
    try {
      await execa('git', ['add', '.github/', '.claude/', 'CLAUDE.md'], { cwd: repoPath });
      await execa('git', ['commit', '-m', 'chore(setup): add Claude Code workspace config and GitHub templates'], { cwd: repoPath });
      console.log(chalk.green('✓ Cambios commiteados en el repo'));
    } catch {
      console.log(chalk.yellow('⚠  No se pudieron commitear los cambios automáticamente. Hazlo manualmente.'));
    }
  } catch (err) {
    spinner.fail(`Error: ${err.message}`);
    process.exit(1);
  }

  return { repoPath, owner: owner.trim(), repoName: repoName.trim() };
}

// ──────────────────────────────────────────────────────────────
// PASO 4b — Multi repo
// ──────────────────────────────────────────────────────────────

async function stepMultiRepo(ghUser, { selectedSkills, mcpConfig, projectToken, projectSummary } = {}) {
  console.log(chalk.bold.cyan('\n═══ Paso 4 — Configuración multi-repo ═══\n'));

  const workspaceName = await input({
    message: 'Nombre del workspace:',
    validate: (v) => v.trim().length > 0 || 'Requerido',
  });

  const workspaceParent = await input({
    message: 'Directorio donde crear el workspace:',
    default: process.cwd(),
    validate: (v) => {
      const p = path.resolve(v.trim());
      return fs.existsSync(p) || `El directorio no existe: ${p}`;
    },
  });

  const workspacePath = path.join(path.resolve(workspaceParent.trim()), workspaceName.trim());
  const workspaceExisted = fs.existsSync(workspacePath);
  fs.mkdirSync(workspacePath, { recursive: true });
  if (!workspaceExisted) trackCreatedDir(workspacePath);
  console.log(chalk.gray(`  → Workspace: ${workspacePath}`));

  const owner = await input({
    message: 'GitHub owner o organización principal:',
    default: ghUser ?? '',
    validate: (v) => v.trim().length > 0 || 'Requerido',
  });

  console.log(chalk.cyan('\n── Lista de repositorios del workspace ──\n'));
  const entries = await askReposBatch();

  console.log(chalk.gray(`\n${entries.length} repo(s) detectado(s). Ahora configuremos cada uno:\n`));

  const repos = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let repoPath;
    let repoOwner;
    let repoName;

    if (entry.kind === 'path') {
      repoPath = entry.value;

      if (!isGitRepo(repoPath)) {
        console.log(chalk.yellow(`  ⚠  "${repoPath}" no es un repo git — se salta`));
        continue;
      }

      const remoteUrl = await getRemoteOrigin(repoPath);
      if (remoteUrl) {
        try {
          const parsed = parseGithubUrl(remoteUrl);
          repoOwner = parsed.owner;
          repoName = parsed.repo;

          // Detectar conflicto de cuentas en repo local sin token
          if (!projectToken && repoOwner.toLowerCase() !== ghUser?.toLowerCase()) {
            console.log(chalk.yellow(
              `\n  ⚠  "${repoName}": el remote pertenece a "${repoOwner}" pero tu sesión es "${ghUser}".`
            ));
            const wantsToken = await confirm({
              message: `¿Ingresar un token para "${repoOwner}" y usarlo en todos los repos restantes?`,
              default: true,
            });
            if (wantsToken) {
              const ghInstalled = await isGhInstalled();
              const creds = await askAndValidateToken(ghInstalled);
              projectToken = creds.token;
              ghUser = creds.username;
            } else {
              console.log(chalk.yellow('  ⚠  Continuando sin reconfigurar.'));
            }
          }
        } catch {
          // sin detección — pedir nombre después
        }
      }
      if (!repoName) repoName = path.basename(repoPath);

      // Repo local existente: reconfigurar remote si hay token de proyecto
      if (projectToken) {
        const updated = await setRepoRemoteWithCreds(repoPath, { username: ghUser, token: projectToken });
        if (updated) console.log(chalk.gray(`  → Remote origin de "${repoName}" reconfigurado con credenciales del proyecto`));
        await setGitUserLocal(repoPath, { name: ghUser });
      }

      // Normalizar modelo de branches del repo local
      if (repoOwner && repoName) {
        await normalizeRepoBranches(repoPath, { owner: repoOwner, repo: repoName, token: projectToken, label: repoName });
      }
    } else {
      try {
        const { cleanUrl, username: urlUser, token: urlToken } = extractCredsFromUrl(entry.value);
        if (urlUser && urlToken) {
          console.log(chalk.gray(`  → Credenciales detectadas en URL del repo ${repoName ?? ''} — validando...`));
          const validated = await preflightTokenValidation(urlToken, urlUser);
          if (validated) {
            projectToken = validated.token;
            ghUser = validated.username;
          } else {
            console.log(chalk.yellow('  ⚠  Continuando sin las credenciales de esta URL'));
          }
        }
        const parsed = parseGithubUrl(cleanUrl);
        repoOwner = parsed.owner;
        repoName = parsed.repo;
        repoPath = path.join(workspacePath, repoName);
        entry.value = cleanUrl;
      } catch (err) {
        console.log(chalk.red(`✗ ${err.message} — se salta`));
        continue;
      }
      if (!fs.existsSync(repoPath)) {
        trackCreatedDir(repoPath);
        await cloneRepo(entry.value, repoPath, { username: ghUser, token: projectToken });
      } else {
        console.log(chalk.gray(`  → ${repoName} ya existe en ${repoPath} — se usa tal cual`));
      }

      // Fijar remote con creds del proyecto en cada repo clonado/existente
      if (projectToken) {
        const updated = await setRepoRemoteWithCreds(repoPath, { username: ghUser, token: projectToken });
        if (updated) console.log(chalk.gray(`  → Remote origin de "${repoName}" configurado con credenciales del proyecto`));
        await setGitUserLocal(repoPath, { name: ghUser });
      }

      // Normalizar modelo de branches del repo clonado
      if (repoOwner && repoName) {
        await normalizeRepoBranches(repoPath, { owner: repoOwner, repo: repoName, token: projectToken, label: repoName });
      }
    }

    if (!repoOwner) repoOwner = owner.trim();

    console.log(chalk.bold.white(`\n[${i + 1}/${entries.length}] ${repoOwner}/${repoName}`));
    const role = await input({ message: `Rol de "${repoName}" (ej: API central, Frontend principal):` });
    const detectedPort = detectPort(repoPath);
    const port = await input({ message: 'Puerto local (o vacío si no aplica):', default: detectedPort ?? '' });
    const stacks = await resolveStacks(repoPath, repoName);

    repos.push({
      name: repoName.trim(),
      owner: repoOwner.trim(),
      stack: stackLabel(stacks),
      stacks,
      port: port.trim() || 'N/A',
      role: role.trim(),
      repoPath,
    });

    console.log(chalk.green(`  ✓ Repo "${repoName}" configurado\n`));
  }

  if (repos.length === 0) {
    console.log(chalk.red('✗ No se configuró ningún repo válido.'));
    process.exit(1);
  }

  // Generar workspace root
  const spinner = ora('Generando CLAUDE.md y estructura .claude/ del workspace...').start();
  try {
    generateMultiRepoCLAUDE(workspacePath, {
      projectName: workspaceName.trim(),
      projectDescription: projectSummary ?? workspaceName.trim(),
      owner: owner.trim(),
      repos,
    });
    const allStacks = [...new Set(repos.flatMap((r) => r.stacks))];
    generateClaudeDir(workspacePath, allStacks, { selectedSkills, mcpConfig });
    spinner.succeed('Workspace raíz generado');
  } catch (err) {
    spinner.fail(`Error generando workspace: ${err.message}`);
    process.exit(1);
  }

  // Generar issue templates y CLAUDE.md en cada repo
  for (const repo of repos) {
    const repoSpinner = ora(`Configurando repo "${repo.name}"...`).start();
    try {
      generateSingleRepoCLAUDE(repo.repoPath, {
        projectName: workspaceName.trim(),
        projectDescription: projectSummary ?? workspaceName.trim(),
        stack: repo.stack,
        port: repo.port,
        owner: repo.owner,
        repoName: repo.name,
      });
      generateClaudeDir(repo.repoPath, repo.stacks, { selectedSkills });
      generateIssueTemplates(repo.repoPath);
      ensureClaudeCredentialsIgnored(repo.repoPath);

      // Commitear
      try {
        await execa('git', ['add', '.github/', '.claude/', 'CLAUDE.md'], { cwd: repo.repoPath });
        await execa('git', ['commit', '-m', 'chore(setup): add Claude Code workspace config and GitHub templates'], { cwd: repo.repoPath });
      } catch {
        // sin cambios o sin permisos — no bloquea
      }

      repoSpinner.succeed(`Repo "${repo.name}" configurado`);
    } catch (err) {
      repoSpinner.fail(`Error en "${repo.name}": ${err.message}`);
    }
  }

  return { workspacePath, owner: owner.trim(), repos };
}

// ──────────────────────────────────────────────────────────────
// PASO 4c — Descripción del proyecto y dominio
// ──────────────────────────────────────────────────────────────

async function stepProjectContext() {
  console.log(chalk.bold.cyan('\n═══ Contexto del proyecto ═══\n'));

  const projectSummary = await input({
    message: 'Describe tu proyecto en 1-2 frases:',
    validate: (v) => v.trim().length > 0 || 'La descripción no puede estar vacía',
  });

  return { projectSummary: projectSummary.trim() };
}

// ──────────────────────────────────────────────────────────────
// PASO 4d — Selección de skills
// ──────────────────────────────────────────────────────────────

const ALL_SKILLS = [
  // — Flujo principal (activados por defecto) —
  { value: 'init',     name: '/init     — Orientar: lee estado, issues activos y rama actual',              checked: true  },
  { value: 'plan',     name: '/plan     — Planificar: crea work-items (feature/refactor/fix/chore) y sus tasks',  checked: true  },
  { value: 'apply',    name: '/apply    — Ejecutar: toma el issue activo y lo implementa',                  checked: true  },
  { value: 'test',     name: '/test     — Verificar: corre suite, reporta cobertura, detecta huecos',       checked: true  },
  { value: 'build',    name: '/build    — Guardar: commit + push + comenta progreso en el issue',           checked: true  },
  { value: 'review',   name: '/review   — Revisar: code review del PR con perspectiva fresca',              checked: true  },
  { value: 'secure',   name: '/secure   — Validar: pre-deploy security checklist (env, secrets, deps)',     checked: true  },
  { value: 'deploy',   name: '/deploy   — Publicar: Dockerfile + GitHub Actions + .env.example',           checked: true  },
  { value: 'branches', name: '/branches — Normalizar: main + dev (obligatoria) + staging opcional',        checked: true  },
  // — Comandos de soporte —
  { value: 'debug',    name: '/debug    — Depurar: analiza error/log, propone y aplica el fix',             checked: false },
  { value: 'audit',    name: '/audit    — Auditar: revisión OWASP profunda del código de aplicación',          checked: false },
  { value: 'pentest',  name: '/pentest  — Barrida completa: secrets, CVEs, endpoints, infra, análisis estático', checked: false },
  { value: 'sync',     name: '/sync     — Resincronizar: detecta drift entre código y plan en GitHub',      checked: false },
  { value: 'rollback', name: '/rollback — Revertir: deshace el último deploy de forma segura',              checked: false },
  { value: 'design',   name: '/design   — Diseñar: UI/UX, estilos, componentes, accesibilidad',            checked: false },
  { value: 'triage',   name: '/triage   — Limpiar: cierra issues cubiertos, mueve estados en bulk',        checked: false },
  { value: 'cross',    name: '/cross    — Multi-repo: cambios que afectan varios repos a la vez',           checked: false },
  { value: 'setup',    name: '/setup    — Refresh: regenera CLAUDE.md y config de un repo individual',      checked: false },
];

function stepSkillsSelection() {
  return ALL_SKILLS.map((s) => s.value);
}

// ──────────────────────────────────────────────────────────────
// PASO 5 — GitHub Project (opcional)
// ──────────────────────────────────────────────────────────────

async function stepGithubProject(repoOwner, projectToken = null) {
  console.log(chalk.bold.cyan('\n═══ Paso 5 — GitHub Project ═══\n'));
  console.log(chalk.gray('Un GitHub Project es el tablero donde viven los issues y el estado del workspace.\n'));

  const action = await select({
    message: '¿Qué quieres hacer con el GitHub Project?',
    choices: [
      { name: 'Usar uno que ya tengo (por número o URL)',  value: 'existing' },
      { name: 'Crear uno nuevo',                           value: 'create' },
      { name: 'Elegir de la lista de mis projects',        value: 'pick' },
      { name: 'Ninguno por ahora',                         value: 'skip' },
    ],
  });

  if (action === 'skip') return null;

  // Preguntar el owner del Project — puede ser org o usuario, distinto al repo
  const projectOwner = await input({
    message: `Owner del GitHub Project (org o usuario):`,
    default: repoOwner,
    validate: (v) => v.trim().length > 0 || 'Requerido',
  });
  const owner = projectOwner.trim();

  if (action === 'existing') {
    const raw = await input({
      message: 'Número o URL del GitHub Project:',
      validate: (v) => parseProjectInput(v) !== null || 'Debe ser un número (ej: 5) o URL (.../projects/N)',
    });
    const number = parseProjectInput(raw);
    try {
      const data = await getGithubProject(owner, number, projectToken);
      console.log(chalk.green(`✓ Project encontrado: ${data.title} — ${data.url}`));
      return { ...data, owner };
    } catch (err) {
      console.log(chalk.yellow(`⚠  No se pudo leer el project #${number}: ${err.message}`));
      return null;
    }
  }

  if (action === 'pick') {
    const projects = await listGithubProjects(owner, projectToken);
    if (projects.length === 0) {
      console.log(chalk.yellow(`⚠  No se encontraron projects para ${owner}. Intenta crear uno nuevo.`));
      return null;
    }
    const picked = await select({
      message: 'Elige un GitHub Project:',
      choices: projects.map((p) => ({
        name: `#${p.number} — ${p.title}`,
        value: p.number,
      })),
    });
    const data = projects.find((p) => p.number === picked);
    console.log(chalk.green(`✓ Usando: ${data.title} — ${data.url}`));
    return { ...data, owner };
  }

  // action === 'create'
  const projectTitle = await input({
    message: 'Nombre del GitHub Project:',
    validate: (v) => v.trim().length > 0 || 'Requerido',
  });

  return await createProjectWithRecovery(owner, projectTitle.trim(), projectToken);
}

/**
 * Intenta crear un GitHub Project. Si falla, muestra un diagnóstico específico
 * (permisos, scope del token, owner inválido) y ofrece opciones reales en vez
 * de continuar con null:
 *   - Crearlo manualmente y pegar el número/URL
 *   - Probar con otro nombre/owner
 *   - Usar un Project existente
 *   - Cancelar el setup
 *
 * @param {string} owner
 * @param {string} title
 * @param {string|null} projectToken
 * @returns {object|null}
 */
async function createProjectWithRecovery(owner, title, projectToken) {
  try {
    const data = await createGithubProject(owner, title, projectToken);
    return { ...data, owner };
  } catch (err) {
    const msg = err.message ?? '';
    console.log(chalk.red('\n✗ No se pudo crear el GitHub Project'));
    console.log(chalk.gray(`  Error: ${msg}\n`));

    // Diagnóstico específico según el error
    if (/does not have permission/i.test(msg) || /permission/i.test(msg)) {
      console.log(chalk.bold.yellow('Causa probable: permisos insuficientes'));
      console.log(chalk.white('  1. Tu token podría no tener el scope ') + chalk.cyan('project') + chalk.white(' activado.'));
      console.log(chalk.gray('     Edítalo en: ') + chalk.cyan('https://github.com/settings/tokens'));
      console.log(chalk.white(`  2. La organización "${owner}" puede restringir creación de Projects a owners/admins.`));
      console.log(chalk.gray(`     Verifica tu rol en: https://github.com/orgs/${owner}/people\n`));
    } else if (/not found|404/i.test(msg)) {
      console.log(chalk.bold.yellow(`Causa probable: el owner "${owner}" no existe o tu token no tiene acceso\n`));
    } else {
      console.log(chalk.bold.yellow('Consulta el error arriba y GitHub para el detalle.\n'));
    }

    console.log(chalk.bold('Cómo crear el Project manualmente:'));
    console.log(chalk.white(`  1. Abre: `) + chalk.cyan(`https://github.com/orgs/${owner}/projects/new`));
    console.log(chalk.gray(`     (o https://github.com/users/${owner}/projects/new si es usuario personal)`));
    console.log(chalk.white(`  2. Título sugerido: `) + chalk.cyan(title));
    console.log(chalk.white(`  3. Template: `) + chalk.cyan('Team planning') + chalk.gray(' (o el que prefieras)'));
    console.log(chalk.white(`  4. Una vez creado, copia el número o URL del Project\n`));

    const next = await select({
      message: '¿Qué prefieres hacer?',
      choices: [
        { name: 'Ya lo creé manualmente — ingresar número o URL ahora',     value: 'manual' },
        { name: 'Elegir uno que ya existe en mi cuenta',                    value: 'pick' },
        { name: 'Reintentar creación (ej: después de ajustar permisos)',    value: 'retry' },
        { name: 'Continuar SIN GitHub Project — los skills que lo usan fallarán', value: 'skip' },
        { name: 'Cancelar setup',                                           value: 'abort' },
      ],
    });

    if (next === 'abort') {
      console.log(chalk.yellow('\nSetup cancelado por el usuario.\n'));
      process.exit(0);
    }

    if (next === 'skip') {
      console.log(chalk.yellow('⚠  Continuando sin GitHub Project. Recuerda configurarlo después con /setup.\n'));
      return null;
    }

    if (next === 'retry') {
      return await createProjectWithRecovery(owner, title, projectToken);
    }

    if (next === 'manual') {
      const raw = await input({
        message: `Número o URL del Project recién creado:`,
        validate: (v) => parseProjectInput(v) !== null || 'Debe ser un número (ej: 5) o URL (.../projects/N)',
      });
      const number = parseProjectInput(raw);
      try {
        const data = await getGithubProject(owner, number, projectToken);
        console.log(chalk.green(`✓ Project vinculado: ${data.title} — ${data.url}`));
        return { ...data, owner };
      } catch (e) {
        console.log(chalk.red(`✗ No se pudo leer el Project #${number}: ${e.message}`));
        return await createProjectWithRecovery(owner, title, projectToken);
      }
    }

    if (next === 'pick') {
      const projects = await listGithubProjects(owner, projectToken);
      if (projects.length === 0) {
        console.log(chalk.yellow(`⚠  No se encontraron Projects para "${owner}".`));
        return await createProjectWithRecovery(owner, title, projectToken);
      }
      const picked = await select({
        message: 'Elige un GitHub Project existente:',
        choices: projects.map((p) => ({ name: `#${p.number} — ${p.title}`, value: p.number })),
      });
      const data = projects.find((p) => p.number === picked);
      console.log(chalk.green(`✓ Usando: ${data.title} — ${data.url}`));
      return { ...data, owner };
    }
  }

  return null;
}

// ──────────────────────────────────────────────────────────────
// PASO 5.5 — Herramientas recomendadas (Context7 + UI UX Pro Max)
// ──────────────────────────────────────────────────────────────

async function stepRecommendedTools() {
  const tools = [
    {
      key: 'context7',
      name: 'Context7',
      desc: 'docs actualizadas de cualquier librería directamente en tu prompt',
      check: async () => {
        const which = process.platform === 'win32' ? 'where' : 'which';
        try { await execa(which, ['context7-mcp']); return true; } catch { return false; }
      },
      install: async () => {
        const spinner = ora('Instalando Context7...').start();
        try {
          await execa('npm', ['install', '-g', '@upstash/context7-mcp']);
          spinner.succeed('Context7 instalado');
        } catch {
          spinner.fail('No se pudo instalar Context7 automáticamente');
          console.log(chalk.gray('  Instálalo manualmente: npm install -g @upstash/context7-mcp'));
        }
      },
    },
    {
      key: 'uipro',
      name: 'UI UX Pro Max',
      desc: 'inteligencia de diseño: estilos, paletas, componentes y tipografía',
      check: async () => {
        const which = process.platform === 'win32' ? 'where' : 'which';
        try { await execa(which, ['uipro']); return true; } catch { return false; }
      },
      install: async () => {
        const spinner = ora('Instalando UI UX Pro Max...').start();
        try {
          await execa('npm', ['install', '-g', 'uipro-cli'], { stdio: 'inherit' });
          await execa('uipro', ['init', '--ai', 'claude'], { stdio: 'inherit' });
          spinner.succeed('UI UX Pro Max instalado');
        } catch {
          spinner.fail('No se pudo instalar UI UX Pro Max automáticamente');
          console.log(chalk.gray('  Instálalo manualmente:'));
          console.log(chalk.gray('    npm install -g uipro-cli'));
          console.log(chalk.gray('    uipro init --ai claude'));
        }
      },
    },
  ];

  console.log(chalk.bold.cyan('\n═══ Herramientas recomendadas ═══\n'));
  console.log(chalk.gray('Estas herramientas potencian a Claude Code en cualquier proyecto:\n'));

  for (const tool of tools) {
    console.log(`  ${chalk.bold(tool.name)} — ${tool.desc}`);
  }

  console.log('');
  const install = await confirm({
    message: '¿Las instalo ahora?',
    default: true,
  });

  if (!install) {
    console.log(chalk.gray('\n  Puedes instalarlas después con el skill /tools en tu workspace.\n'));
    return;
  }

  console.log('');
  for (const tool of tools) {
    await tool.install();
  }
  console.log('');
}

// ──────────────────────────────────────────────────────────────
// PASO 6 — Resumen final
// ──────────────────────────────────────────────────────────────

function stepSummary({ rootPath, projectData, projectType, hasProjectToken = false }) {
  console.log(chalk.bold.cyan('\n═══ Resumen — Todo listo ═══\n'));

  console.log(chalk.bold('Estructura generada:\n'));
  try {
    console.log(chalk.gray(printGeneratedTree(rootPath)));
  } catch {
    console.log(chalk.gray(`  ${rootPath}`));
  }

  if (projectData?.url) {
    console.log(chalk.bold('\nGitHub Project:'));
    console.log(chalk.cyan(`  ${projectData.url}`));
  }

  console.log(chalk.bold('\nPróximos pasos:\n'));
  console.log(chalk.white('  1. Abre el workspace en tu editor:'));
  console.log(chalk.gray(`       code "${rootPath}"   # VS Code`));
  console.log(chalk.gray(`       cursor "${rootPath}" # Cursor`));
  console.log('');
  console.log(chalk.white('  2. Abre Claude Code y ejecuta:'));
  console.log(chalk.bold.green('       /init'));
  console.log('');
  console.log(chalk.white('  3. Para planificar features:'));
  console.log(chalk.bold.green('       /plan'));
  console.log('');
  if (projectData?.url) {
    console.log(chalk.white('  4. GitHub Project:'));
    console.log(chalk.cyan(`       ${projectData.url}`));
    console.log('');
  }
  if (hasProjectToken) {
    console.log(chalk.bold('Token de GitHub por proyecto:'));
    console.log(chalk.gray('  Guardado en .claude-credentials (ignorado por git). Para usar gh CLI en este proyecto:'));
    console.log(chalk.cyan('    set -a && source .claude-credentials && set +a'));
    console.log(chalk.gray('  O en un solo comando:'));
    console.log(chalk.cyan('    env $(cat .claude-credentials) gh <comando>\n'));
  }
  console.log(chalk.bold.green('¡Workspace configurado correctamente! 🚀\n'));
}

// ──────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────

async function main() {
  const version = getCurrentPackageVersion();
  const innerWidth = 39; // ancho entre los bordes ║
  const content = `     workspace-template  v${version}`;
  const versionLine = `║${content}${' '.repeat(Math.max(1, innerWidth - content.length))}║`;
  console.log(chalk.bold.magenta('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.magenta(versionLine));
  console.log(chalk.bold.magenta('║  Claude Code Workspace Setup CLI      ║'));
  console.log(chalk.bold.magenta('╚═══════════════════════════════════════╝\n'));

  // Paso 1
  await stepEnvCheck();

  // Paso 2
  const { ghUser, projectToken } = await stepGithubAuth();

  // Paso 3
  const projectType = await stepProjectType();

  // Paso 4c — contexto del proyecto
  const { projectSummary } = await stepProjectContext();

  // Paso 4d — skills
  const selectedSkills = stepSkillsSelection();

  const mcpConfig = null;

  let rootPath;
  let owner;
  let allRepoPaths = [];

  if (projectType === 'single') {
    const result = await stepSingleRepo(ghUser, { selectedSkills, mcpConfig, projectToken, projectSummary });
    rootPath = result.repoPath;
    owner = result.owner;
    allRepoPaths = [result.repoPath];
  } else {
    const result = await stepMultiRepo(ghUser, { selectedSkills, mcpConfig, projectToken, projectSummary });
    rootPath = result.workspacePath;
    owner = result.owner;
    allRepoPaths = [result.workspacePath, ...result.repos.map((r) => r.repoPath)];
  }

  // Siempre fijar git user.name local en cada repo (evita que commits usen identidad global)
  for (const p of allRepoPaths) {
    await setGitUserLocal(p, { name: ghUser });
  }

  // Guardar credenciales en .claude-credentials en cada repo cuando hay token de proyecto
  if (projectToken) {
    for (const p of allRepoPaths) {
      let remote = null;
      try {
        const url = await getRemoteOrigin(p);
        if (url) {
          const parsed = parseGithubUrl(url);
          if (parsed.owner && parsed.repo) remote = `${parsed.owner}/${parsed.repo}`;
        }
      } catch { /* sin remote — omitir */ }
      saveProjectGithubCredentials(p, { username: ghUser, token: projectToken, remote });
    }
    console.log(chalk.green(`✓ Credenciales guardadas en .claude-credentials de ${allRepoPaths.length} ubicación(es) — ignoradas por git\n`));
  }

  // Paso 5
  const projectData = await stepGithubProject(owner, projectToken);

  // Persistir GitHub Project ID en .workspace-version para que los skills lo lean
  if (projectData) {
    saveGithubProject(rootPath, { ...projectData, owner });
  }

  // Paso 5.5 — herramientas recomendadas
  await stepRecommendedTools();

  // Paso 6
  stepSummary({ rootPath, projectData, projectType, hasProjectToken: !!projectToken });
}

// ──────────────────────────────────────────────────────────────
// Router de subcomandos
// ──────────────────────────────────────────────────────────────

function printHelp() {
  console.log(chalk.bold.magenta('\nworkspace-template — CLI para Claude Code\n'));
  console.log(chalk.white('Uso:'));
  console.log(chalk.gray('  npx workspace-template            ') + chalk.white('Inicializa un workspace nuevo'));
  console.log(chalk.gray('  npx workspace-template update [path]') + chalk.white('  Actualiza skills/rules a la última versión'));
  console.log(chalk.gray('  npx workspace-template version    ') + chalk.white('Muestra la versión instalada'));
  console.log(chalk.gray('  npx workspace-template help       ') + chalk.white('Muestra esta ayuda\n'));
}

async function router() {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case undefined:
    case 'init':
    case 'new':
      return main();

    case 'update':
    case 'upgrade': {
      const target = rest[0] ?? process.cwd();
      return runUpdate(target);
    }

    case 'version':
    case '--version':
    case '-v':
      console.log(getCurrentPackageVersion());
      return;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;

    default:
      console.log(chalk.red(`\n✗ Comando desconocido: "${cmd}"`));
      printHelp();
      process.exit(1);
  }
}

router()
  .then(() => {
    // Completado exitosamente — limpiar tracker para que el SIGINT handler
    // no borre nada si llega una señal post-éxito
    createdResources.dirs.clear();
  })
  .catch(async (err) => {
    if (err.name === 'ExitPromptError') {
      console.log(chalk.yellow('\n\nSaliendo... (operación cancelada por el usuario)'));
      await cleanupPartialState();
      process.exit(0);
    }
    console.error(chalk.red('\n✗ Error inesperado:'), err.message);
    await cleanupPartialState();
    process.exit(1);
  });
