import fs from 'fs';
import path from 'path';
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
    nextjs: 'typescript.md',
    react: 'typescript.md',
    vue: 'typescript.md',
    nuxt: 'typescript.md',
    django: 'python-django.md',
    fastapi: 'python-fastapi.md',
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

  // Skills — usar subset seleccionado o los 4 por defecto
  const defaultSkills = ['session-start', 'progress-tracker', 'planning', 'code-review'];
  const skillsToInclude = opts.selectedSkills ?? defaultSkills;
  for (const skill of skillsToInclude) {
    const fileName = `${skill}.md`;
    const srcPath = path.join(TEMPLATES_DIR, 'skills', fileName);
    if (fs.existsSync(srcPath)) {
      copyTemplate(`skills/${fileName}`, path.join(claudeDir, 'skills', fileName));
    }
  }

  // settings.json — MCP config (si se proporcionó)
  if (opts.mcpConfig) {
    const settingsPath = path.join(claudeDir, 'settings.json');
    let existing = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        // archivo corrupto — empezar de cero
      }
    }
    const merged = {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers ?? {}),
        ...opts.mcpConfig.mcpServers,
      },
    };
    ensureDir(claudeDir);
    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  }
}

/**
 * Genera el CLAUDE.md para un workspace multi-repo.
 *
 * @param {string} workspacePath
 * @param {object} ctx - contexto para la plantilla
 * @param {string} ctx.projectName
 * @param {string} ctx.projectDescription
 * @param {object[]} ctx.repos - [{ name, stack, port, role, repoUrl }]
 * @param {string} ctx.owner
 */
export function generateMultiRepoCLAUDE(workspacePath, ctx) {
  const tmpl = loadTemplate('CLAUDE.md.hbs');
  const content = tmpl(ctx);
  writeFile(path.join(workspacePath, 'CLAUDE.md'), content);
}

/**
 * Genera el CLAUDE.md para un repo single.
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
  const tmpl = loadTemplate('CLAUDE.single.md.hbs');
  const content = tmpl(ctx);
  writeFile(path.join(repoPath, 'CLAUDE.md'), content);
}

/**
 * Genera los issue templates de GitHub en un repo.
 * @param {string} repoPath
 * @returns {string[]} lista de archivos generados (relativos al repo)
 */
export function generateIssueTemplates(repoPath) {
  const files = [];
  const templateSrcs = [
    { src: 'github/ISSUE_TEMPLATE/feature.md', dest: '.github/ISSUE_TEMPLATE/feature.md' },
    { src: 'github/ISSUE_TEMPLATE/bug.md', dest: '.github/ISSUE_TEMPLATE/bug.md' },
    { src: 'github/ISSUE_TEMPLATE/epic.md', dest: '.github/ISSUE_TEMPLATE/epic.md' },
    { src: 'github/pull_request_template.md', dest: '.github/pull_request_template.md' },
  ];

  for (const { src, dest } of templateSrcs) {
    const destFull = path.join(repoPath, dest);
    copyTemplate(src, destFull);
    files.push(dest);
  }
  return files;
}

/**
 * Imprime un árbol de la estructura generada para mostrar al usuario.
 * @param {string} rootPath
 * @returns {string}
 */
export function printGeneratedTree(rootPath) {
  const lines = [];

  function walk(dir, prefix = '') {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      // directorios primero
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';
      lines.push(`${prefix}${connector}${entry.name}`);
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), prefix + childPrefix);
      }
    }
  }

  lines.push(path.basename(rootPath) + '/');
  walk(rootPath);
  return lines.join('\n');
}
