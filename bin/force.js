#!/usr/bin/env node
/**
 * force-template — CLI para configurar un workspace de Claude Code
 * Uso: node bin/force.js  |  npx force-template  |  ./setup.sh
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
import { showInstallInstructions, showPresentTools } from '../lib/installer.js';
import { runEnvBootstrap } from '../lib/env-bootstrap.js';
import {
  checkGhAuth,
  cloneRepo,
  createGithubProject,
  getGithubProject,
  listGithubProjects,
  parseGithubUrl,
  parseProjectInput,
  getRemoteOrigin,
  showGhAuthHelp,
} from '../lib/github.js';
import {
  generateClaudeDir,
  generateMultiRepoCLAUDE,
  generateSingleRepoCLAUDE,
  generateIssueTemplates,
  printGeneratedTree,
} from '../lib/workspace-gen.js';
import { askMcpIntegrations, mergeMcpConfig } from '../lib/mcp-tools.js';

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────

/** Espera a que el usuario presione Enter */
async function pressEnter(msg = 'Presiona Enter para continuar...') {
  await input({ message: chalk.gray(msg), default: '' });
}

/** Mapeo de valor de stack a label legible */
const STACK_LABELS = {
  nextjs: 'Next.js / React',
  vue: 'Vue / Nuxt',
  django: 'Django / Python',
  fastapi: 'FastAPI / Python',
  'react-native': 'React Native',
  flutter: 'Flutter',
  other: 'Otro (texto libre)',
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

async function stepGithubAuth() {
  console.log(chalk.bold.cyan('═══ Paso 2 — Autenticación GitHub ═══\n'));

  let { authenticated, user } = await checkGhAuth();

  if (!authenticated) {
    showGhAuthHelp(chalk);
    await pressEnter('Cuando hayas terminado de autenticarte, presiona Enter para continuar...');

    const result = await checkGhAuth();
    authenticated = result.authenticated;
    user = result.user;

    if (!authenticated) {
      console.log(chalk.red('✗ Aún no autenticado. Por favor completa gh auth login.'));
      process.exit(1);
    }
  }

  console.log(chalk.green(`✓ Autenticado como: ${chalk.bold(user ?? 'desconocido')}\n`));
  return user;
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

async function stepSingleRepo(ghUser, { selectedSkills, mcpConfig } = {}) {
  console.log(chalk.bold.cyan('\n═══ Paso 4 — Configuración single-repo ═══\n'));

  const projectName = await input({
    message: 'Nombre del proyecto:',
    validate: (v) => v.trim().length > 0 || 'El nombre no puede estar vacío',
  });

  const projectDescription = await input({
    message: 'Descripción breve del proyecto:',
    default: `Plataforma ${projectName}`,
  });

  const alreadyCloned = await confirm({
    message: '¿El repositorio ya está clonado localmente?',
    default: true,
  });

  let repoPath;
  let owner;
  let repoName;

  if (alreadyCloned) {
    repoPath = await input({
      message: 'Ruta local del repositorio (absoluta):',
      validate: (v) => {
        const p = v.trim();
        return (p.length > 0 && fs.existsSync(p)) || `La ruta no existe: ${p}`;
      },
    });
    repoPath = path.resolve(repoPath.trim());

    // Intentar obtener owner/repo del remote
    const remoteUrl = await getRemoteOrigin(repoPath);
    if (remoteUrl) {
      try {
        const parsed = parseGithubUrl(remoteUrl);
        owner = parsed.owner;
        repoName = parsed.repo;
        console.log(chalk.gray(`  → Detectado: ${owner}/${repoName}`));
      } catch {
        // no detectado
      }
    }
  } else {
    const repoUrl = await input({
      message: 'URL del repositorio GitHub (HTTPS o SSH):',
      validate: (v) => v.trim().length > 0 || 'La URL no puede estar vacía',
    });

    const destParent = await input({
      message: 'Directorio donde clonar:',
      default: process.cwd(),
    });

    try {
      const parsed = parseGithubUrl(repoUrl.trim());
      owner = parsed.owner;
      repoName = parsed.repo;
      repoPath = path.join(path.resolve(destParent.trim()), repoName);
      await cloneRepo(repoUrl.trim(), repoPath);
    } catch (err) {
      console.log(chalk.red(`✗ ${err.message}`));
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

  const port = await input({
    message: 'Puerto local del servicio (si aplica, o deja vacío):',
    default: '',
  });

  const stacks = await askStacks(repoName);

  // Generar archivos
  const spinner = ora('Generando CLAUDE.md y estructura .claude/...').start();
  try {
    generateSingleRepoCLAUDE(repoPath, {
      projectName: projectName.trim(),
      projectDescription: projectDescription.trim(),
      stack: stackLabel(stacks),
      port: port.trim() || 'N/A',
      owner: owner.trim(),
      repoName: repoName.trim(),
    });
    generateClaudeDir(repoPath, stacks, { selectedSkills, mcpConfig });
    const templateFiles = generateIssueTemplates(repoPath);
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

async function stepMultiRepo(ghUser, { selectedSkills, mcpConfig } = {}) {
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
  fs.mkdirSync(workspacePath, { recursive: true });
  console.log(chalk.gray(`  → Workspace: ${workspacePath}`));

  const owner = await input({
    message: 'GitHub owner o organización principal:',
    default: ghUser ?? '',
    validate: (v) => v.trim().length > 0 || 'Requerido',
  });

  const projectDescription = await input({
    message: 'Descripción del proyecto:',
    default: `Plataforma ${workspaceName.trim()}`,
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
      const remoteUrl = await getRemoteOrigin(repoPath);
      if (remoteUrl) {
        try {
          const parsed = parseGithubUrl(remoteUrl);
          repoOwner = parsed.owner;
          repoName = parsed.repo;
        } catch {
          // sin detección — pedir nombre después
        }
      }
      if (!repoName) repoName = path.basename(repoPath);
    } else {
      try {
        const parsed = parseGithubUrl(entry.value);
        repoOwner = parsed.owner;
        repoName = parsed.repo;
        repoPath = path.join(workspacePath, repoName);
      } catch (err) {
        console.log(chalk.red(`✗ ${err.message} — se salta`));
        continue;
      }
      if (!fs.existsSync(repoPath)) {
        await cloneRepo(entry.value, repoPath);
      } else {
        console.log(chalk.gray(`  → ${repoName} ya existe en ${repoPath} — se usa tal cual`));
      }
    }

    if (!repoOwner) repoOwner = owner.trim();

    console.log(chalk.bold.white(`\n[${i + 1}/${entries.length}] ${repoOwner}/${repoName}`));
    const role = await input({ message: `Rol de "${repoName}" (ej: API central, Frontend principal):` });
    const port = await input({ message: 'Puerto local (o vacío si no aplica):', default: '' });
    const stacks = await askStacks(repoName);

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
      projectDescription: projectDescription.trim(),
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
        projectDescription: repo.role,
        stack: repo.stack,
        port: repo.port,
        owner: repo.owner,
        repoName: repo.name,
      });
      generateClaudeDir(repo.repoPath, repo.stacks, { selectedSkills });
      generateIssueTemplates(repo.repoPath);

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
    message: 'Describe tu proyecto en 1-2 frases (esto ayuda a generar skills contextuales):',
    validate: (v) => v.trim().length > 0 || 'La descripción no puede estar vacía',
  });

  const domain = await select({
    message: '¿Cuál es el dominio principal?',
    choices: [
      { name: 'E-commerce / marketplace',  value: 'ecommerce' },
      { name: 'SaaS B2B',                  value: 'saas-b2b' },
      { name: 'Fintech / cobranza',         value: 'fintech' },
      { name: 'CRM / ventas',               value: 'crm' },
      { name: 'Salud / healthcare',         value: 'healthcare' },
      { name: 'Educación',                  value: 'educacion' },
      { name: 'Logística',                  value: 'logistica' },
      { name: 'Otro (texto libre)',          value: 'otro' },
    ],
  });

  let domainLabel = domain;
  if (domain === 'otro') {
    domainLabel = await input({ message: 'Describe el dominio:' });
  }

  return { projectSummary: projectSummary.trim(), domain: domainLabel };
}

// ──────────────────────────────────────────────────────────────
// PASO 4d — Selección de skills
// ──────────────────────────────────────────────────────────────

const ALL_SKILLS = [
  { value: 'session-start',    name: 'session-start      — Inicia sesión: revisa issues activos, estado del repo',          checked: true },
  { value: 'progress-tracker', name: 'progress-tracker   — Guarda progreso: commit + push + comenta en el issue',           checked: true },
  { value: 'planning',         name: 'planning            — Planifica: crea issues, epics, sub-issues en GitHub',           checked: true },
  { value: 'code-review',      name: 'code-review         — Revisa PRs con perspectiva fresca',                             checked: true },
  { value: 'cross-repo',       name: 'cross-repo          — Cambios que afectan múltiples repos a la vez',                  checked: false },
  { value: 'triage',           name: 'triage              — Cierra issues cubiertos, mueve estados en bulk',                checked: false },
  { value: 'security-review',  name: 'security-review     — Revisión de seguridad de los cambios pendientes',               checked: false },
  { value: 'ui-ux',            name: 'ui-ux               — Diseño UI/UX: estilos, componentes, accesibilidad',             checked: false },
  { value: 'repo-setup',       name: 'repo-setup          — Configura un repo individual para trabajo atómico',             checked: false },
];

async function stepSkillsSelection() {
  console.log(chalk.bold.cyan('\n═══ Selección de skills ═══\n'));
  console.log(chalk.gray('Los skills son comandos /slash que Claude Code reconoce en este workspace.'));
  console.log(chalk.gray('Solo los seleccionados se copiarán a .claude/skills/\n'));

  const selected = await checkbox({
    message: '¿Qué skills quieres incluir?',
    choices: ALL_SKILLS,
    validate: (v) => v.length > 0 || 'Selecciona al menos un skill',
  });

  return selected;
}

// ──────────────────────────────────────────────────────────────
// PASO 5 — GitHub Project (opcional)
// ──────────────────────────────────────────────────────────────

async function stepGithubProject(owner) {
  console.log(chalk.bold.cyan('\n═══ Paso 5 — GitHub Project ═══\n'));
  console.log(chalk.gray('Un GitHub Project es el tablero donde viven los issues y el estado del workspace.\n'));

  const action = await select({
    message: '¿Qué quieres hacer con el GitHub Project?',
    choices: [
      { name: 'Usar uno que ya tengo (por número o URL)',       value: 'existing' },
      { name: 'Crear uno nuevo',                                 value: 'create' },
      { name: 'Elegir de la lista de mis projects',              value: 'pick' },
      { name: 'Ninguno por ahora',                               value: 'skip' },
    ],
  });

  if (action === 'skip') return null;

  if (action === 'existing') {
    const raw = await input({
      message: 'Número o URL del GitHub Project:',
      validate: (v) => parseProjectInput(v) !== null || 'Debe ser un número (ej: 5) o URL (.../projects/N)',
    });
    const number = parseProjectInput(raw);
    try {
      const data = await getGithubProject(owner, number);
      console.log(chalk.green(`✓ Project encontrado: ${data.title} — ${data.url}`));
      return data;
    } catch (err) {
      console.log(chalk.yellow(`⚠  No se pudo leer el project #${number}: ${err.message}`));
      return null;
    }
  }

  if (action === 'pick') {
    const projects = await listGithubProjects(owner);
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
    return data;
  }

  // action === 'create'
  const projectTitle = await input({
    message: 'Nombre del GitHub Project:',
    validate: (v) => v.trim().length > 0 || 'Requerido',
  });

  try {
    return await createGithubProject(owner, projectTitle.trim());
  } catch (err) {
    console.log(chalk.yellow(`⚠  No se pudo crear el proyecto: ${err.message}`));
    console.log(chalk.gray('  Puedes crearlo manualmente en https://github.com/orgs/' + owner + '/projects/new'));
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// PASO 6 — Resumen final
// ──────────────────────────────────────────────────────────────

function stepSummary({ rootPath, projectData, projectType }) {
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
  console.log(chalk.bold.green('       /session-start'));
  console.log('');
  console.log(chalk.white('  3. Para planificar features:'));
  console.log(chalk.bold.green('       /planning'));
  console.log('');
  if (projectData?.url) {
    console.log(chalk.white('  4. GitHub Project:'));
    console.log(chalk.cyan(`       ${projectData.url}`));
    console.log('');
  }
  console.log(chalk.bold.green('¡Workspace configurado correctamente! 🚀\n'));
}

// ──────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────

async function main() {
  console.log(chalk.bold.magenta('\n╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.magenta('║       force-template  v1.0.0          ║'));
  console.log(chalk.bold.magenta('║  Claude Code Workspace Setup CLI      ║'));
  console.log(chalk.bold.magenta('╚═══════════════════════════════════════╝\n'));

  // Paso 1
  await stepEnvCheck();

  // Paso 2
  const ghUser = await stepGithubAuth();

  // Paso 3
  const projectType = await stepProjectType();

  // Paso 4c — contexto del proyecto
  const { projectSummary, domain } = await stepProjectContext();

  // Paso 4d — skills
  const selectedSkills = await stepSkillsSelection();

  // Paso 4e — integraciones MCP
  const mcpConfig = await askMcpIntegrations();

  let rootPath;
  let owner;

  if (projectType === 'single') {
    const result = await stepSingleRepo(ghUser, { selectedSkills, mcpConfig });
    rootPath = result.repoPath;
    owner = result.owner;
  } else {
    const result = await stepMultiRepo(ghUser, { selectedSkills, mcpConfig });
    rootPath = result.workspacePath;
    owner = result.owner;
  }

  // Paso 5
  const projectData = await stepGithubProject(owner);

  // Paso 6
  stepSummary({ rootPath, projectData, projectType });
}

main().catch((err) => {
  if (err.name === 'ExitPromptError') {
    console.log(chalk.yellow('\n\nSaliendo... (operación cancelada por el usuario)\n'));
    process.exit(0);
  }
  console.error(chalk.red('\n✗ Error inesperado:'), err.message);
  process.exit(1);
});
