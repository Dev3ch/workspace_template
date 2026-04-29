/**
 * updater.js
 * Actualiza los skills, rules, scripts, GitHub templates y CLAUDE.md de un
 * workspace ya configurado a la última versión publicada de workspace-template,
 * preservando personalizaciones del usuario.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import { confirm, checkbox } from '@inquirer/prompts';
import Handlebars from 'handlebars';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const PKG_PATH = path.join(__dirname, '..', 'package.json');

/**
 * Mapa de los GitHub templates que se sincronizan en cada repo.
 * src es relativo a templates/, dest es relativo al repoPath.
 */
const GITHUB_TEMPLATE_FILES = [
  { src: 'github/ISSUE_TEMPLATE/feature.md',  dest: '.github/ISSUE_TEMPLATE/feature.md' },
  { src: 'github/ISSUE_TEMPLATE/refactor.md', dest: '.github/ISSUE_TEMPLATE/refactor.md' },
  { src: 'github/ISSUE_TEMPLATE/chore.md',    dest: '.github/ISSUE_TEMPLATE/chore.md' },
  { src: 'github/ISSUE_TEMPLATE/bug.md',      dest: '.github/ISSUE_TEMPLATE/bug.md' },
  { src: 'github/ISSUE_TEMPLATE/task.md',     dest: '.github/ISSUE_TEMPLATE/task.md' },
  { src: 'github/pull_request_template.md',   dest: '.github/pull_request_template.md' },
];

/**
 * Lee la versión actual del paquete workspace-template instalado.
 */
export function getCurrentPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  return pkg.version;
}

/**
 * Lee la versión registrada en el workspace (si existe).
 * Se guarda en .claude/.workspace-version como JSON.
 */
export function readInstalledVersion(workspacePath) {
  const versionFile = path.join(workspacePath, '.claude', '.workspace-version');
  if (!fs.existsSync(versionFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(versionFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Escribe el archivo de versión en el workspace.
 */
export function writeInstalledVersion(workspacePath, data) {
  const claudeDir = path.join(workspacePath, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const versionFile = path.join(claudeDir, '.workspace-version');
  fs.writeFileSync(versionFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Calcula el hash SHA-256 de un archivo.
 */
async function hashFile(filePath) {
  const { createHash } = await import('crypto');
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/** Versión sync para uso en helpers donde ya tenemos el contenido. */
function hashContentSync(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ──────────────────────────────────────────────────────────────
// Helpers para CLAUDE.md (Handlebars)
// ──────────────────────────────────────────────────────────────

/**
 * Renderiza CLAUDE.md desde su .hbs usando el contexto persistido.
 * Devuelve { content, templateName } o null si no se puede.
 *
 * @param {string} workspacePath - directorio que contiene CLAUDE.md
 * @param {object} ctx - contexto de generación guardado en .workspace-version.claudeMd.context
 * @param {'multi'|'single'} kind
 */
function renderClaudeMd(ctx, kind) {
  const tmplFile = kind === 'multi' ? 'CLAUDE.md.hbs' : 'CLAUDE.single.md.hbs';
  const tmplPath = path.join(TEMPLATES_DIR, tmplFile);
  const source = fs.readFileSync(tmplPath, 'utf8');
  const tmpl = Handlebars.compile(source);
  return { content: tmpl(ctx), tmplFile, tmplPath };
}

/**
 * Compara CLAUDE.md local con el que se regeneraría usando el contexto guardado.
 * Estados:
 *  - missingContext: no podemos regenerar (workspace generado por una versión vieja sin contexto persistido)
 *  - missing: el archivo no existe (se reinstala)
 *  - unchanged: la regeneración da exactamente el mismo CLAUDE.md
 *  - updated: el .hbs upstream cambió → la regeneración cambia el CLAUDE.md, el local NO tiene cambios manuales
 *  - customized: el dev editó CLAUDE.md a mano
 */
async function diffClaudeMd(workspacePath, installed) {
  const claudeMdPath = path.join(workspacePath, 'CLAUDE.md');
  const meta = installed?.claudeMd;

  if (!meta || !meta.kind || !meta.context) {
    return { state: 'missingContext', path: claudeMdPath };
  }

  const { content: regenerated, tmplFile } = renderClaudeMd(meta.context, meta.kind);
  const regeneratedHash = hashContentSync(Buffer.from(regenerated, 'utf8'));

  if (!fs.existsSync(claudeMdPath)) {
    return { state: 'missing', path: claudeMdPath, regenerated, regeneratedHash, tmplFile };
  }

  const currentBuf = fs.readFileSync(claudeMdPath);
  const currentHash = hashContentSync(currentBuf);

  if (currentHash === regeneratedHash) {
    return { state: 'unchanged', path: claudeMdPath, regeneratedHash, tmplFile };
  }

  if (meta.lastRenderedHash && currentHash === meta.lastRenderedHash) {
    return { state: 'updated', path: claudeMdPath, regenerated, regeneratedHash, tmplFile };
  }

  return { state: 'customized', path: claudeMdPath, regenerated, regeneratedHash, tmplFile };
}

/**
 * Diff genérico para un archivo Handlebars-rendered (con contexto persistido).
 * Mismos estados que diffClaudeMd. Devuelve además el destPath relativo al
 * workspace y el contenido regenerado para que applyUpdates pueda escribirlo.
 */
async function diffHbsDoc({
  workspacePath,
  meta,        // { context, templateFile, lastRenderedHash, destPath }
  defaultDest, // ruta relativa al workspace si meta.destPath no está
}) {
  const destRel = meta?.destPath ?? defaultDest;
  const docPath = path.join(workspacePath, destRel);

  if (!meta || !meta.context || !meta.templateFile) {
    return { state: 'missingContext', path: docPath, destRel };
  }

  const tmplPath = path.join(TEMPLATES_DIR, meta.templateFile);
  if (!fs.existsSync(tmplPath)) {
    return { state: 'unchanged', path: docPath, destRel };
  }
  const source = fs.readFileSync(tmplPath, 'utf8');
  const tmpl = Handlebars.compile(source);
  const regenerated = tmpl(meta.context);
  const regeneratedHash = hashContentSync(Buffer.from(regenerated, 'utf8'));

  if (!fs.existsSync(docPath)) {
    return { state: 'missing', path: docPath, destRel, regenerated, regeneratedHash };
  }

  const currentHash = hashContentSync(fs.readFileSync(docPath));
  if (currentHash === regeneratedHash) {
    return { state: 'unchanged', path: docPath, destRel, regeneratedHash };
  }
  if (meta.lastRenderedHash && currentHash === meta.lastRenderedHash) {
    return { state: 'updated', path: docPath, destRel, regenerated, regeneratedHash };
  }
  return { state: 'customized', path: docPath, destRel, regenerated, regeneratedHash };
}

// ──────────────────────────────────────────────────────────────
// Diff principal
// ──────────────────────────────────────────────────────────────

/**
 * Compara los skills/rules/scripts/github templates instalados contra los del template actual.
 * Retorna un diff con entradas: new, updated, unchanged, customized, removed, deletedByUser.
 *
 * Reglas clave (el dev manda sobre lo local):
 * - Si un archivo del template fue borrado localmente (estuvo en el registry pero
 *   no existe en disco), va a `deletedByUser` y NO se reinstala automáticamente.
 * - `new` solo aplica a archivos del template que nunca estuvieron instalados aquí.
 * - Archivos locales que no son del template (custom del dev) ni se listan ni se tocan.
 *
 * El bloque `claudeMd` se calcula aparte (es un único archivo Handlebars-rendered).
 */
export async function computeDiff(workspacePath) {
  const diff = {
    skills:  { new: [], updated: [], unchanged: [], customized: [], removed: [], deletedByUser: [] },
    rules:   { new: [], updated: [], unchanged: [], customized: [], removed: [], deletedByUser: [] },
    scripts: { new: [], updated: [], unchanged: [], customized: [], removed: [], deletedByUser: [] },
    github:  { new: [], updated: [], unchanged: [], customized: [], removed: [], deletedByUser: [] },
    claudeMd: null,
  };

  const installed = readInstalledVersion(workspacePath)
    ?? { skills: {}, rules: {}, scripts: {}, github: {} };

  // ── skills / rules / scripts (idéntico al comportamiento previo) ──
  for (const kind of ['skills', 'rules', 'scripts']) {
    const srcDir = path.join(TEMPLATES_DIR, kind);
    const dstDir = path.join(workspacePath, '.claude', kind);

    if (!fs.existsSync(srcDir)) continue;

    const filterExt = kind === 'scripts' ? null : '.md';
    const srcFiles = fs.readdirSync(srcDir).filter((f) => !filterExt || f.endsWith(filterExt));
    const srcNames = new Set(srcFiles.map((f) => filterExt ? f.replace(/\.md$/, '') : f));

    if (fs.existsSync(dstDir)) {
      if (kind === 'skills') {
        const installedDirs = fs.readdirSync(dstDir, { withFileTypes: true })
          .filter((e) => e.isDirectory()).map((e) => e.name);
        for (const skillName of installedDirs) {
          if (!srcNames.has(skillName)) {
            diff[kind].removed.push({ file: `${skillName}.md`, skillName });
          }
        }
      } else if (kind === 'rules') {
        const installedFiles = fs.readdirSync(dstDir).filter((f) => f.endsWith('.md'));
        for (const file of installedFiles) {
          const ruleName = file.replace(/\.md$/, '');
          if (!srcNames.has(ruleName)) diff[kind].removed.push({ file });
        }
      } else {
        const installedFiles = fs.readdirSync(dstDir);
        for (const file of installedFiles) {
          if (!srcNames.has(file)) diff[kind].removed.push({ file });
        }
      }
    }

    for (const file of srcFiles) {
      const name = filterExt ? file.replace(/\.md$/, '') : file;
      const srcPath = path.join(srcDir, file);
      const dstPath = kind === 'skills'
        ? path.join(dstDir, name, 'SKILL.md')
        : path.join(dstDir, file);
      const srcHash = await hashFile(srcPath);
      const registryKey = kind === 'skills' ? name : file;
      const originalHash = installed[kind]?.[registryKey];

      if (!fs.existsSync(dstPath)) {
        if (originalHash) {
          diff[kind].deletedByUser.push({ file, srcHash, originalHash });
        } else {
          diff[kind].new.push({ file, srcHash });
        }
        continue;
      }

      const dstHash = await hashFile(dstPath);
      if (srcHash === dstHash) {
        diff[kind].unchanged.push({ file, srcHash });
      } else if (originalHash && originalHash !== dstHash) {
        diff[kind].customized.push({ file, srcHash, dstHash, originalHash });
      } else {
        diff[kind].updated.push({ file, srcHash, dstHash });
      }
    }
  }

  // ── GitHub templates (planos, sin variables) ──
  // Solo aplica a directorios que ya tengan .github/ — workspaces multi-repo
  // root no llevan github templates (los llevan los repos individuales).
  const hasGithubDir = fs.existsSync(path.join(workspacePath, '.github'));
  const wasGithubInstalled = !!installed.github && Object.keys(installed.github).length > 0;

  if (hasGithubDir || wasGithubInstalled) {
    const installedGithub = installed.github ?? {};
    const srcKeys = new Set(GITHUB_TEMPLATE_FILES.map((e) => e.dest));

    // Archivos en el registry que ya no existen en el template upstream → removed
    for (const registeredDest of Object.keys(installedGithub)) {
      if (!srcKeys.has(registeredDest)) {
        diff.github.removed.push({ file: registeredDest });
      }
    }

    for (const { src, dest } of GITHUB_TEMPLATE_FILES) {
      const srcPath = path.join(TEMPLATES_DIR, src);
      const dstPath = path.join(workspacePath, dest);
      if (!fs.existsSync(srcPath)) continue;

      const srcHash = await hashFile(srcPath);
      const originalHash = installedGithub[dest];

      if (!fs.existsSync(dstPath)) {
        if (originalHash) {
          diff.github.deletedByUser.push({ file: dest, src, srcHash, originalHash });
        } else {
          diff.github.new.push({ file: dest, src, srcHash });
        }
        continue;
      }

      const dstHash = await hashFile(dstPath);
      if (srcHash === dstHash) {
        diff.github.unchanged.push({ file: dest, src, srcHash });
      } else if (originalHash && originalHash !== dstHash) {
        diff.github.customized.push({ file: dest, src, srcHash, dstHash, originalHash });
      } else {
        diff.github.updated.push({ file: dest, src, srcHash, dstHash });
      }
    }
  }

  // ── CLAUDE.md ──
  diff.claudeMd = await diffClaudeMd(workspacePath, installed);

  // ── docs/QUICK_START.md (Handlebars-rendered) ──
  diff.quickStart = await diffHbsDoc({
    workspacePath,
    meta: installed?.quickStart,
    defaultDest: 'docs/QUICK_START.md',
  });

  return diff;
}

/**
 * Aplica los cambios seleccionados al workspace.
 */
export async function applyUpdates(workspacePath, selections) {
  const spinner = ora('Aplicando actualizaciones...').start();
  const versionData = readInstalledVersion(workspacePath)
    ?? { skills: {}, rules: {}, scripts: {}, github: {} };
  versionData.skills  ??= {};
  versionData.rules   ??= {};
  versionData.scripts ??= {};
  versionData.github  ??= {};
  let applied = 0;
  let removed = 0;

  try {
    // Eliminar archivos obsoletos (skills, rules, scripts, github)
    for (const kind of ['skills', 'rules', 'scripts', 'github']) {
      for (const entry of selections[`${kind}Removed`] ?? []) {
        if (kind === 'skills') {
          const skillName = entry.file.replace(/\.md$/, '');
          const dstDir = path.join(workspacePath, '.claude', kind, skillName);
          if (fs.existsSync(dstDir)) fs.rmSync(dstDir, { recursive: true, force: true });
          delete versionData.skills[skillName];
        } else if (kind === 'github') {
          const dstPath = path.join(workspacePath, entry.file);
          if (fs.existsSync(dstPath)) fs.unlinkSync(dstPath);
          delete versionData.github[entry.file];
        } else {
          const dstPath = path.join(workspacePath, '.claude', kind, entry.file);
          if (fs.existsSync(dstPath)) fs.unlinkSync(dstPath);
          delete versionData[kind][entry.file];
        }
        removed++;
      }
    }

    // Copiar archivos nuevos/actualizados
    for (const kind of ['skills', 'rules', 'scripts']) {
      for (const file of selections[kind] ?? []) {
        const skillName = file.replace(/\.md$/, '');
        const srcPath = path.join(TEMPLATES_DIR, kind, file);
        const dstPath = kind === 'skills'
          ? path.join(workspacePath, '.claude', kind, skillName, 'SKILL.md')
          : path.join(workspacePath, '.claude', kind, file);

        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.copyFileSync(srcPath, dstPath);
        if (kind === 'scripts' && file.endsWith('.sh')) fs.chmodSync(dstPath, 0o755);

        versionData[kind][kind === 'skills' ? skillName : file] = await hashFile(srcPath);
        applied++;
      }
    }

    // GitHub templates (clave = ruta destino relativa al repo)
    for (const dest of selections.github ?? []) {
      const entry = GITHUB_TEMPLATE_FILES.find((e) => e.dest === dest);
      if (!entry) continue;
      const srcPath = path.join(TEMPLATES_DIR, entry.src);
      const dstPath = path.join(workspacePath, dest);
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      versionData.github[dest] = await hashFile(srcPath);
      applied++;
    }

    // CLAUDE.md (regeneración via Handlebars con el contexto persistido)
    if (selections.claudeMd) {
      const meta = versionData.claudeMd;
      if (meta?.kind && meta?.context) {
        const { content, tmplFile } = renderClaudeMd(meta.context, meta.kind);
        const tmplPath = path.join(TEMPLATES_DIR, tmplFile);
        const claudeMdPath = path.join(workspacePath, 'CLAUDE.md');
        fs.writeFileSync(claudeMdPath, content, 'utf8');
        versionData.claudeMd = {
          ...meta,
          templateHash: await hashFile(tmplPath),
          lastRenderedHash: hashContentSync(Buffer.from(content, 'utf8')),
          regeneratedAt: new Date().toISOString(),
        };
        applied++;
      }
    }

    // docs/QUICK_START.md (regeneración via Handlebars con contexto persistido)
    if (selections.quickStart) {
      const meta = versionData.quickStart;
      if (meta?.context && meta?.templateFile) {
        const tmplPath = path.join(TEMPLATES_DIR, meta.templateFile);
        if (fs.existsSync(tmplPath)) {
          const source = fs.readFileSync(tmplPath, 'utf8');
          const tmpl = Handlebars.compile(source);
          const content = tmpl(meta.context);
          const destRel = meta.destPath ?? 'docs/QUICK_START.md';
          const docPath = path.join(workspacePath, destRel);
          fs.mkdirSync(path.dirname(docPath), { recursive: true });
          fs.writeFileSync(docPath, content, 'utf8');
          versionData.quickStart = {
            ...meta,
            templateHash: await hashFile(tmplPath),
            lastRenderedHash: hashContentSync(Buffer.from(content, 'utf8')),
            regeneratedAt: new Date().toISOString(),
          };
          applied++;
        }
      }
    }

    versionData.version = getCurrentPackageVersion();
    versionData.updatedAt = new Date().toISOString();
    writeInstalledVersion(workspacePath, versionData);

    const parts = [];
    if (applied > 0) parts.push(`${applied} actualizado(s)`);
    if (removed > 0) parts.push(`${removed} eliminado(s)`);
    spinner.succeed(parts.join(', ') || 'Sin cambios');
    return applied + removed;
  } catch (err) {
    spinner.fail(`Error aplicando actualizaciones: ${err.message}`);
    throw err;
  }
}

/**
 * Persiste la configuración del GitHub Project en .workspace-version.
 */
export function saveGithubProject(workspacePath, projectData) {
  const versionData = readInstalledVersion(workspacePath) ?? {};
  versionData.githubProject = {
    number: projectData.number,
    url: projectData.url,
    title: projectData.title,
    owner: projectData.owner ?? null,
  };
  writeInstalledVersion(workspacePath, versionData);
}

/**
 * Lee la configuración del GitHub Project guardada.
 */
export function readGithubProject(workspacePath) {
  const data = readInstalledVersion(workspacePath);
  return data?.githubProject ?? null;
}

/**
 * Ejecuta el flujo completo de update en un workspace.
 */
export async function runUpdate(workspacePath) {
  const resolved = path.resolve(workspacePath);

  console.log(chalk.bold.cyan('\n═══ Actualización de workspace-template ═══\n'));

  const claudeDir = path.join(resolved, '.claude');
  if (!fs.existsSync(claudeDir)) {
    console.log(chalk.red(`✗ No se encontró ${claudeDir}`));
    console.log(chalk.gray('  Este directorio no parece ser un workspace generado por workspace-template.'));
    console.log(chalk.gray('  Corre primero: npx workspace-template'));
    process.exit(1);
  }

  const installed = readInstalledVersion(resolved);
  const current = getCurrentPackageVersion();

  if (installed?.version) {
    console.log(chalk.gray(`  Versión instalada: ${installed.version}`));
    console.log(chalk.gray(`  Versión disponible: ${current}`));
  } else {
    console.log(chalk.yellow('  ⚠  No se detectó versión previa — primera actualización registrada.'));
  }
  console.log();

  const diff = await computeDiff(resolved);

  // ── Resumen ──
  const sum = (kind) => ({
    new: diff[kind].new.length,
    updated: diff[kind].updated.length,
    customized: diff[kind].customized.length,
    removed: diff[kind].removed.length,
    deletedByUser: diff[kind].deletedByUser.length,
    unchanged: diff[kind].unchanged.length,
  });
  const sk = sum('skills');
  const ru = sum('rules');
  const sc = sum('scripts');
  const gh = sum('github');

  const printKind = (label, s) => {
    console.log(chalk.white(`  ${label}:`));
    console.log(chalk.green(`    + ${s.new} nuevo(s) del template`));
    console.log(chalk.cyan(`    ~ ${s.updated} actualizado(s) upstream`));
    console.log(chalk.yellow(`    ! ${s.customized} personalizado(s) (tienen cambios locales)`));
    console.log(chalk.red(`    - ${s.removed} obsoleto(s) (ya no existen en el template)`));
    console.log(chalk.magenta(`    × ${s.deletedByUser} borrado(s) localmente (no se reinstalan)`));
    console.log(chalk.gray(`    · ${s.unchanged} sin cambios`));
  };

  console.log(chalk.bold('Cambios detectados:\n'));
  printKind('Skills',          sk);
  console.log();
  printKind('Rules',           ru);
  console.log();
  printKind('Scripts',         sc);
  console.log();
  printKind('GitHub templates', gh);
  console.log();

  // CLAUDE.md
  console.log(chalk.white('  CLAUDE.md:'));
  const cm = diff.claudeMd;
  if (cm.state === 'unchanged') {
    console.log(chalk.gray('    · sin cambios'));
  } else if (cm.state === 'updated') {
    console.log(chalk.cyan('    ~ template upstream cambió — se regenerará'));
  } else if (cm.state === 'customized') {
    console.log(chalk.yellow('    ! tienes cambios locales — preguntará antes de sobrescribir'));
  } else if (cm.state === 'missing') {
    console.log(chalk.green('    + falta — se generará'));
  } else if (cm.state === 'missingContext') {
    console.log(chalk.gray('    · no hay contexto persistido (workspace pre-v0.x sin claudeMd.context) — se omite'));
  }
  console.log();

  // docs/QUICK_START.md
  console.log(chalk.white('  docs/QUICK_START.md:'));
  const qs = diff.quickStart;
  if (qs.state === 'unchanged') {
    console.log(chalk.gray('    · sin cambios'));
  } else if (qs.state === 'updated') {
    console.log(chalk.cyan('    ~ template upstream cambió — se regenerará'));
  } else if (qs.state === 'customized') {
    console.log(chalk.yellow('    ! tienes cambios locales — preguntará antes de sobrescribir'));
  } else if (qs.state === 'missing') {
    console.log(chalk.green('    + falta — se generará'));
  } else if (qs.state === 'missingContext') {
    console.log(chalk.gray('    · no hay contexto persistido (workspace pre-1.1.3) — se omite'));
  }
  console.log();

  // ── Selecciones ──
  // deletedByUser NO entra en el conteo de pendientes — son "no-op por defecto"
  const docPending = (state) => state === 'updated' || state === 'customized' || state === 'missing' ? 1 : 0;
  const totalPending =
    sk.new + sk.updated + sk.customized + sk.removed +
    ru.new + ru.updated + ru.customized + ru.removed +
    sc.new + sc.updated + sc.customized + sc.removed +
    gh.new + gh.updated + gh.customized + gh.removed +
    docPending(cm.state) + docPending(qs.state);

  if (totalPending === 0) {
    const totalDeleted =
      sk.deletedByUser + ru.deletedByUser + sc.deletedByUser + gh.deletedByUser;
    if (totalDeleted > 0) {
      console.log(chalk.gray('Hay archivos que borraste localmente; se respetan y no se reinstalan.\n'));
    }
    console.log(chalk.bold.green('✓ Ya estás al día. No hay nada que actualizar.\n'));
    return;
  }

  const selections = {
    skills: [], rules: [], scripts: [], github: [], claudeMd: false, quickStart: false,
    skillsRemoved: [], rulesRemoved: [], scriptsRemoved: [], githubRemoved: [],
  };

  for (const kind of ['skills', 'rules', 'scripts', 'github']) {
    const choices = [
      ...diff[kind].new.map((e) => ({
        name: chalk.green(`+ ${e.file}`) + chalk.gray('  (nuevo)'),
        value: e.file, checked: true,
      })),
      ...diff[kind].updated.map((e) => ({
        name: chalk.cyan(`~ ${e.file}`) + chalk.gray('  (actualizado upstream)'),
        value: e.file, checked: true,
      })),
      ...diff[kind].customized.map((e) => ({
        name: chalk.yellow(`! ${e.file}`) + chalk.gray('  (tienes cambios locales — se sobrescribirán)'),
        value: e.file, checked: false,
      })),
      ...diff[kind].deletedByUser.map((e) => ({
        name: chalk.magenta(`× ${e.file}`) + chalk.gray('  (lo borraste localmente — marcar solo si quieres reinstalarlo)'),
        value: e.file, checked: false,
      })),
    ];

    const removedChoices = diff[kind].removed.map((e) => ({
      name: chalk.red(`- ${e.file}`) + chalk.gray('  (ya no existe en el template — se eliminará)'),
      value: e.file, checked: true,
    }));

    if (choices.length === 0 && removedChoices.length === 0) continue;

    if (choices.length > 0) {
      const picked = await checkbox({
        message: `¿Qué ${kind} actualizar?`,
        choices,
        instructions: false,
      });
      selections[kind] = picked;
    }

    if (removedChoices.length > 0) {
      const pickedRemoved = await checkbox({
        message: `¿Qué ${kind} obsoletos eliminar?`,
        choices: removedChoices,
        instructions: false,
      });
      const removedKey = `${kind}Removed`;
      selections[removedKey] = diff[kind].removed.filter((e) => pickedRemoved.includes(e.file));
    }
  }

  // CLAUDE.md prompt — caso a caso
  if (cm.state === 'updated' || cm.state === 'missing') {
    selections.claudeMd = await confirm({
      message: cm.state === 'missing'
        ? 'CLAUDE.md no existe — ¿generarlo desde el template actual?'
        : 'CLAUDE.md tiene cambios upstream y no editaste el archivo localmente — ¿regenerar?',
      default: true,
    });
  } else if (cm.state === 'customized') {
    console.log(chalk.yellow(
      '\n⚠  CLAUDE.md tiene cambios locales que difieren del template y del último render.\n' +
      '   Regenerarlo sobrescribirá tus cambios. Considerá hacer git diff antes de aceptar.'
    ));
    selections.claudeMd = await confirm({
      message: '¿Sobrescribir CLAUDE.md con la versión regenerada del template?',
      default: false,
    });
  }

  // QUICK_START.md prompt — mismo patrón
  if (qs.state === 'updated' || qs.state === 'missing') {
    selections.quickStart = await confirm({
      message: qs.state === 'missing'
        ? 'docs/QUICK_START.md no existe — ¿generarlo desde el template actual?'
        : 'docs/QUICK_START.md tiene cambios upstream y no editaste el archivo localmente — ¿regenerar?',
      default: true,
    });
  } else if (qs.state === 'customized') {
    console.log(chalk.yellow(
      '\n⚠  docs/QUICK_START.md tiene cambios locales que difieren del template y del último render.'
    ));
    selections.quickStart = await confirm({
      message: '¿Sobrescribir docs/QUICK_START.md con la versión regenerada del template?',
      default: false,
    });
  }

  const total =
    selections.skills.length + selections.rules.length +
    selections.scripts.length + selections.github.length +
    selections.skillsRemoved.length + selections.rulesRemoved.length +
    selections.scriptsRemoved.length + selections.githubRemoved.length +
    (selections.claudeMd ? 1 : 0) + (selections.quickStart ? 1 : 0);

  if (total === 0) {
    console.log(chalk.gray('\nNada seleccionado — saliendo sin cambios.\n'));
    return;
  }

  const go = await confirm({
    message: `Aplicar ${total} actualización(es)?`,
    default: true,
  });
  if (!go) {
    console.log(chalk.gray('\nCancelado.\n'));
    return;
  }

  await applyUpdates(resolved, selections);

  // Intentar commitear
  try {
    await execa('git', ['add', '.claude/', '.github/', 'CLAUDE.md', 'docs/QUICK_START.md'], { cwd: resolved });
    await execa('git', ['commit', '-m', `chore(setup): update workspace-template to ${current}`], { cwd: resolved });
    console.log(chalk.green('✓ Cambios commiteados'));
  } catch {
    console.log(chalk.yellow('⚠  No se pudo commitear automáticamente — hazlo manualmente.'));
  }

  console.log(chalk.bold.green(`\n✓ Workspace actualizado a v${current}\n`));
}
