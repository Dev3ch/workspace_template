import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

/**
 * Lee y compila una plantilla Handlebars.
 * @param {string} templatePath - ruta relativa desde templates/
 * @returns {HandlebarsTemplateDelegate}
 */
function loadTemplate(templatePath) {
  const fullPath = path.join(TEMPLATES_DIR, templatePath);
  const content = fs.readFileSync(fullPath, 'utf8');
  return Handlebars.compile(content);
}

/**
 * Asegura que un directorio exista (recursivo).
 * @param {string} dirPath
 */
function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Escribe un archivo, creando directorios intermedios si hace falta.
 * @param {string} filePath
 * @param {string} content
 */
function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Copia un archivo de templates al destino.
 * @param {string} srcRelative - relativo a templates/
 * @param {string} destPath
 */
function copyTemplate(srcRelative, destPath) {
  const src = path.join(TEMPLATES_DIR, srcRelative);
  ensureDir(path.dirname(destPath));
  fs.copyFileSync(src, destPath);
}

// ──────────────────────────────────────────────────────────────
// GENERADORES PRINCIPALES
// ──────────────────────────────────────────────────────────────

/**
 * Genera la estructura .claude/ en un directorio raíz.
 * Incluye rules/ y skills/ copiando los templates genéricos.
 *
 * @param {string} rootPath - directorio donde crear .claude/
 * @param {string[]} stacks - stacks detectados, p.ej. ['nextjs', 'django']
 * @param {object}  [opts]
 * @param {string[]} [opts.selectedSkills] - subset de skills a incluir (valor del skill, sin .md)
 * @param {object|null} [opts.mcpConfig]   - config MCP para mergear en settings.json
 */
export function generateClaudeDir(rootPath, stacks = [], opts = {}) {
  const claudeDir = path.join(rootPath, '.claude');

  // Rules base (siempre se incluyen)
  const baseRules = ['tests.md', 'commits.md', 'branching.md'];
  for (const rule of baseRules) {
    copyTemplate(`rules/${rule}`, path.join(claudeDir, 'rules', rule));
  }

  // Rules específicas por stack
  const stackRuleMap = {
    nextjs:         'typescript.md',
    react:          'typescript.md',
    vue:            'typescript.md',
    nuxt:           'typescript.md',
    'react-native': 'typescript.md',
    django:         'python-django.md',
    fastapi:        'python-fastapi.md',
    go:             'go.md',
    flutter:        'flutter.md',
  };
  const addedRules = new Set();
  for (const stack of stacks) {
    const ruleFile = stackRuleMap[stack];
    if (ruleFile && !addedRules.has(ruleFile)) {
      const srcPath = path.join(TEMPLATES_DIR, 'rules', ruleFile);
      if (fs.existsSync(srcPath)) {
        copyTemplate(`rules/${ruleFile}`, path.join(claudeDir, 'rules', ruleFile));
        addedRules.add(ruleFile);
      }
    }
  }

  // Skills — usar subset seleccionado o los del flujo principal por defecto
  const defaultSkills = ['init', 'plan', 'apply', 'test', 'build', 'review', 'secure', 'deploy', 'branches'];
  const skillsToInclude = opts.selectedSkills ?? defaultSkills;
  for (const skill of skillsToInclude) {
    const srcPath = path.join(TEMPLATES_DIR, 'skills', `${skill}.md`);
    if (fs.existsSync(srcPath)) {
      // Claude Code requiere: .claude/skills/<name>/SKILL.md
      const destDir = path.join(claudeDir, 'skills', skill);
      ensureDir(destDir);
      fs.copyFileSync(srcPath, path.join(destDir, 'SKILL.md'));
    }
  }

  // Scripts — helpers bash compartidos entre skills (resolución de credenciales, etc.)
  const scriptsDir = path.join(claudeDir, 'scripts');
  const scriptsSrcDir = path.join(TEMPLATES_DIR, 'scripts');
  if (fs.existsSync(scriptsSrcDir)) {
    ensureDir(scriptsDir);
    for (const f of fs.readdirSync(scriptsSrcDir)) {
      const src = path.join(scriptsSrcDir, f);
      const dest = path.join(scriptsDir, f);
      fs.copyFileSync(src, dest);
      if (f.endsWith('.sh')) fs.chmodSync(dest, 0o755);
    }
  }

  // settings.json — siempre se escribe para registrar el hook no-edit-without-plan;
  // si se proporcionó mcpConfig también se mergea.
  const settingsPath = path.join(claudeDir, 'settings.json');
  let existing = {};
  if (fs.existsSync(settingsPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      // archivo corrupto — empezar de cero
    }
  }

  const merged = { ...existing };

  if (opts.mcpConfig) {
    merged.mcpServers = {
      ...(existing.mcpServers ?? {}),
      ...opts.mcpConfig.mcpServers,
    };
  }

  // Hook PreToolUse: enforce no-edit-without-plan. Bloquea Edit/Write/Bash en
  // dev/main/staging y exige rama work-item (feature/*, fix/*, etc.). Ver
  // templates/scripts/no-edit-without-plan.sh. Es idempotente: solo se agrega
  // si el usuario no lo configuró ya (detecta por command path).
  ensureDir(claudeDir);
  merged.hooks = mergeHooks(existing.hooks ?? {});

  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  // Registrar versión y hashes para futuras actualizaciones
  writeVersionMetadata(claudeDir, skillsToInclude);
}

// Comando registrado en settings.hooks.PreToolUse para enforce no-edit-without-plan.
// El path usa $CLAUDE_PROJECT_DIR para que sea portable a cualquier workspace.
export const NO_EDIT_HOOK_CMD = '$CLAUDE_PROJECT_DIR/.claude/scripts/no-edit-without-plan.sh';
const NO_EDIT_HOOK_MATCHER = 'Edit|MultiEdit|Write|NotebookEdit|Bash';

/**
 * Devuelve true si la sección hooks ya tiene registrado el hook no-edit-without-plan.
 */
export function hasNoEditHook(hooks) {
  if (!hooks || typeof hooks !== 'object') return false;
  const pre = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  return pre.some(entry =>
    Array.isArray(entry?.hooks) &&
    entry.hooks.some(h => h?.command === NO_EDIT_HOOK_CMD)
  );
}

/**
 * Inserta el hook PreToolUse no-edit-without-plan en la sección hooks de
 * settings.json sin duplicar si ya existe (matched por command path).
 * Preserva cualquier otro hook que el usuario haya configurado.
 */
export function mergeHooks(existingHooks) {
  if (hasNoEditHook(existingHooks)) {
    return existingHooks ?? {};
  }
  const existingPre = Array.isArray(existingHooks?.PreToolUse) ? existingHooks.PreToolUse : [];
  const ourEntry = {
    matcher: NO_EDIT_HOOK_MATCHER,
    hooks: [{ type: 'command', command: NO_EDIT_HOOK_CMD }],
  };
  return {
    ...(existingHooks ?? {}),
    PreToolUse: [...existingPre, ourEntry],
  };
}

/**
 * Calcula el hash SHA-256 de un archivo (utilidad interna).
 */
function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function hashContent(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Lee la metadata existente de .workspace-version (si existe).
 */
function readVersionMetadata(claudeDir) {
  const versionFile = path.join(claudeDir, '.workspace-version');
  if (!fs.existsSync(versionFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Escribe (o fusiona) la metadata en .workspace-version.
 * Cuando se llama desde generateClaudeDir (durante init), se rehace from scratch.
 * Cuando se llama desde otros generadores (CLAUDE.md, issue templates), se hace patch.
 */
function mergeVersionMetadata(claudeDir, patch) {
  ensureDir(claudeDir);
  const existing = readVersionMetadata(claudeDir) ?? {};
  const merged = { ...existing, ...patch };
  // Asegurar que sub-objetos se fusionan, no se reemplazan, cuando ambos existen.
  for (const key of ['skills', 'rules', 'scripts', 'github', 'githubProject', 'claudeMd', 'quickStart']) {
    if (existing[key] && patch[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key])) {
      merged[key] = { ...existing[key], ...patch[key] };
    }
  }
  merged.updatedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(claudeDir, '.workspace-version'),
    JSON.stringify(merged, null, 2) + '\n',
    'utf8'
  );
}

/**
 * Escribe el archivo .workspace-version con hashes de los archivos instalados.
 * Permite a `update` detectar qué cambió. Reemplaza por completo (init).
 */
function writeVersionMetadata(claudeDir, skillsInstalled) {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  // Conservar metadata previa de generaciones anteriores (CLAUDE.md, github,
  // githubProject) si el caller invoca writeVersionMetadata después de
  // generateMultiRepoCLAUDE / generateIssueTemplates. En la práctica el orden
  // en bin/ es: generate*CLAUDE → generateClaudeDir → generateIssueTemplates,
  // así que generateClaudeDir es el que debe preservar lo que ya escribió
  // generate*CLAUDE.
  const existing = readVersionMetadata(claudeDir) ?? {};

  const data = {
    version: pkg.version,
    skills: {},
    rules: {},
    scripts: {},
    github: existing.github ?? {},
    claudeMd: existing.claudeMd,
    quickStart: existing.quickStart,
    githubProject: existing.githubProject,
    installedAt: existing.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  for (const skill of skillsInstalled) {
    const src = path.join(TEMPLATES_DIR, 'skills', `${skill}.md`);
    if (fs.existsSync(src)) data.skills[skill] = hashFile(src);
  }

  const rulesDir = path.join(claudeDir, 'rules');
  if (fs.existsSync(rulesDir)) {
    for (const f of fs.readdirSync(rulesDir)) {
      const src = path.join(TEMPLATES_DIR, 'rules', f);
      if (fs.existsSync(src)) data.rules[f] = hashFile(src);
    }
  }

  const scriptsSrcDir = path.join(TEMPLATES_DIR, 'scripts');
  if (fs.existsSync(scriptsSrcDir)) {
    for (const f of fs.readdirSync(scriptsSrcDir)) {
      const src = path.join(scriptsSrcDir, f);
      if (fs.existsSync(src)) data.scripts[f] = hashFile(src);
    }
  }

  fs.writeFileSync(
    path.join(claudeDir, '.workspace-version'),
    JSON.stringify(data, null, 2) + '\n',
    'utf8'
  );
}

/**
 * Genera el CLAUDE.md para un workspace multi-repo y registra el contexto +
 * hashes en .claude/.workspace-version para que `update` pueda regenerarlo
 * cuando el .hbs upstream cambie.
 *
 * @param {string} workspacePath
 * @param {object} ctx - contexto para la plantilla (debe ser serializable a JSON)
 * @param {string} ctx.projectName
 * @param {string} ctx.projectDescription
 * @param {object[]} ctx.repos - [{ name, stack, port, role, repoUrl }]
 * @param {string} ctx.owner
 */
export function generateMultiRepoCLAUDE(workspacePath, ctx) {
  const tmplFile = 'CLAUDE.md.hbs';
  const tmplPath = path.join(TEMPLATES_DIR, tmplFile);
  const tmpl = loadTemplate(tmplFile);
  const content = tmpl(ctx);
  const claudeMdPath = path.join(workspacePath, 'CLAUDE.md');
  writeFile(claudeMdPath, content);

  const claudeDir = path.join(workspacePath, '.claude');
  ensureDir(claudeDir);
  mergeVersionMetadata(claudeDir, {
    claudeMd: {
      kind: 'multi',
      context: ctx,
      templateFile: tmplFile,
      templateHash: hashFile(tmplPath),
      lastRenderedHash: hashContent(Buffer.from(content, 'utf8')),
      regeneratedAt: new Date().toISOString(),
    },
  });

  // Quick-start docs (multi-repo): un solo doc en la raíz del workspace,
  // con repoName="<workspace>" para que el header tenga sentido.
  generateQuickStart(workspacePath, {
    projectName: ctx.projectName,
    owner: ctx.owner,
    repoName: ctx.projectName,
  });
}

/**
 * Genera el CLAUDE.md para un repo single y registra el contexto + hashes.
 *
 * @param {string} repoPath
 * @param {object} ctx
 * @param {string} ctx.projectName
 * @param {string} ctx.projectDescription
 * @param {string} ctx.stack
 * @param {number|string} ctx.port
 * @param {string} ctx.owner
 * @param {string} ctx.repoName
 */
export function generateSingleRepoCLAUDE(repoPath, ctx) {
  const tmplFile = 'CLAUDE.single.md.hbs';
  const tmplPath = path.join(TEMPLATES_DIR, tmplFile);
  const tmpl = loadTemplate(tmplFile);
  const content = tmpl(ctx);
  const claudeMdPath = path.join(repoPath, 'CLAUDE.md');
  writeFile(claudeMdPath, content);

  const claudeDir = path.join(repoPath, '.claude');
  ensureDir(claudeDir);
  mergeVersionMetadata(claudeDir, {
    claudeMd: {
      kind: 'single',
      context: ctx,
      templateFile: tmplFile,
      templateHash: hashFile(tmplPath),
      lastRenderedHash: hashContent(Buffer.from(content, 'utf8')),
      regeneratedAt: new Date().toISOString(),
    },
  });

  // Quick-start docs por repo
  generateQuickStart(repoPath, {
    projectName: ctx.projectName,
    owner: ctx.owner,
    repoName: ctx.repoName,
    stack: ctx.stack,
    port: ctx.port,
  });
}

/**
 * Genera docs/QUICK_START.md desde docs/QUICK_START.md.hbs y registra el
 * contexto + hashes en .claude/.workspace-version.
 *
 * Por defecto crea el archivo en `<repoPath>/docs/QUICK_START.md`. Si el dev
 * tiene un `docs/` propio, el archivo coexiste sin pisar nada (se llama
 * QUICK_START.md, no README.md).
 *
 * @param {string} repoPath
 * @param {object} ctx - { projectName, owner, repoName, stack?, port? }
 */
export function generateQuickStart(repoPath, ctx) {
  const tmplFile = 'docs/QUICK_START.md.hbs';
  const tmplPath = path.join(TEMPLATES_DIR, tmplFile);
  if (!fs.existsSync(tmplPath)) return;

  const tmpl = loadTemplate(tmplFile);
  const content = tmpl(ctx);
  const docsPath = path.join(repoPath, 'docs', 'QUICK_START.md');
  writeFile(docsPath, content);

  const claudeDir = path.join(repoPath, '.claude');
  ensureDir(claudeDir);
  mergeVersionMetadata(claudeDir, {
    quickStart: {
      context: ctx,
      templateFile: tmplFile,
      templateHash: hashFile(tmplPath),
      lastRenderedHash: hashContent(Buffer.from(content, 'utf8')),
      regeneratedAt: new Date().toISOString(),
      destPath: 'docs/QUICK_START.md',
    },
  });
}

/**
 * Genera los issue templates de GitHub en un repo y registra los hashes en
 * .claude/.workspace-version para que `update` pueda detectar cambios upstream.
 *
 * @param {string} repoPath
 * @returns {string[]} lista de archivos generados (relativos al repo)
 */
export function generateIssueTemplates(repoPath) {
  const files = [];
  const githubHashes = {};
  const templateSrcs = [
    { src: 'github/ISSUE_TEMPLATE/feature.md', dest: '.github/ISSUE_TEMPLATE/feature.md' },
    { src: 'github/ISSUE_TEMPLATE/refactor.md', dest: '.github/ISSUE_TEMPLATE/refactor.md' },
    { src: 'github/ISSUE_TEMPLATE/chore.md', dest: '.github/ISSUE_TEMPLATE/chore.md' },
    { src: 'github/ISSUE_TEMPLATE/bug.md', dest: '.github/ISSUE_TEMPLATE/bug.md' },
    { src: 'github/ISSUE_TEMPLATE/task.md', dest: '.github/ISSUE_TEMPLATE/task.md' },
    { src: 'github/pull_request_template.md', dest: '.github/pull_request_template.md' },
  ];

  for (const { src, dest } of templateSrcs) {
    const destFull = path.join(repoPath, dest);
    copyTemplate(src, destFull);
    files.push(dest);
    const srcFull = path.join(TEMPLATES_DIR, src);
    githubHashes[dest] = hashFile(srcFull);
  }

  const claudeDir = path.join(repoPath, '.claude');
  // Si .claude/ aún no existe (edge case), créalo para no perder el registro.
  ensureDir(claudeDir);
  mergeVersionMetadata(claudeDir, { github: githubHashes });

  return files;
}

/**
 * Directorios que nunca deben mostrarse aunque no estén en .gitignore.
 * Cubre el caso de proyectos sin .gitignore o con uno incompleto.
 */
const ALWAYS_HIDE_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'env', '__pycache__',
  '.mypy_cache', '.pytest_cache', '.ruff_cache', '.next', '.nuxt',
  'dist', 'build', 'target', '.gradle', '.idea', '.vscode',
  'vendor', '.cache', '.turbo', '.parcel-cache', '.dart_tool',
  'DerivedData', 'Pods', '.expo',
]);

/**
 * Intenta listar archivos tracked + untracked-no-ignored con git.
 * Devuelve null si el directorio no es un repo git.
 * @param {string} rootPath
 * @returns {string[]|null} rutas relativas al rootPath
 */
function listFilesViaGit(rootPath) {
  try {
    const out = execSync(
      'git ls-files --cached --others --exclude-standard',
      { cwd: rootPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return out.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Construye un árbol en texto a partir de una lista de rutas relativas.
 * @param {string} rootName
 * @param {string[]} relPaths
 * @returns {string}
 */
function buildTreeFromPaths(rootName, relPaths) {
  const root = { name: rootName, children: new Map(), isDir: true };

  for (const rel of relPaths) {
    const parts = rel.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map(), isDir: !isLast });
      }
      const child = node.children.get(part);
      if (!isLast) child.isDir = true;
      node = child;
    }
  }

  const lines = [root.name + '/'];
  function render(node, prefix) {
    const entries = [...node.children.values()].sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';
      lines.push(`${prefix}${connector}${entry.name}${entry.isDir ? '/' : ''}`);
      if (entry.isDir) render(entry, prefix + childPrefix);
    }
  }
  render(root, '');
  return lines.join('\n');
}

/**
 * Imprime un árbol de la estructura del proyecto respetando .gitignore.
 *
 * Estrategia:
 *  1. Si el rootPath es un repo git → `git ls-files` (respeta .gitignore).
 *  2. Si no es repo git → walk manual filtrando ALWAYS_HIDE_DIRS.
 *  3. En ambos casos, limita la profundidad para no abrumar al usuario.
 *
 * @param {string} rootPath
 * @param {object} [opts]
 * @param {number} [opts.maxDepth=3] - profundidad máxima a mostrar
 * @returns {string}
 */
export function printGeneratedTree(rootPath, opts = {}) {
  const maxDepth = opts.maxDepth ?? 3;
  const rootName = path.basename(rootPath);

  const gitFiles = listFilesViaGit(rootPath);
  if (gitFiles) {
    // Filtrar por profundidad y por nombres siempre ocultos
    const filtered = gitFiles.filter((rel) => {
      const parts = rel.split('/');
      if (parts.length > maxDepth) return false;
      return !parts.some((p) => ALWAYS_HIDE_DIRS.has(p));
    });
    return buildTreeFromPaths(rootName, filtered);
  }

  // Fallback: walk manual cuando no hay repo git
  const lines = [rootName + '/'];
  function walk(dir, prefix = '', depth = 1) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries = entries
      .filter((e) => !ALWAYS_HIDE_DIRS.has(e.name))
      .filter((e) => !e.name.startsWith('.') || ['.claude', '.github', '.env.example', '.gitignore'].includes(e.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';
      lines.push(`${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}`);
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix + childPrefix, depth + 1);
      }
    }
  }
  walk(rootPath);
  return lines.join('\n');
}
