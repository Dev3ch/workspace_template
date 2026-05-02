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
import { confirm } from '@inquirer/prompts';
import Handlebars from 'handlebars';
import { hasNoEditHook, mergeHooks } from './workspace-gen.js';

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
// Diff de .claude/settings.json (hook no-edit-without-plan)
// ──────────────────────────────────────────────────────────────

/**
 * Estados:
 *   'missing'         → no existe settings.json (lo crearemos con el hook).
 *   'unchanged'       → existe y ya tiene el hook registrado.
 *   'needsHookMerge'  → existe pero le falta el hook → mergear preservando lo demás.
 *   'corrupt'         → existe pero no es JSON válido → no tocar, avisar al user.
 */
function diffSettings(workspacePath) {
  const settingsPath = path.join(workspacePath, '.claude', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return { state: 'missing', path: settingsPath };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (err) {
    return { state: 'corrupt', path: settingsPath, error: err.message };
  }
  if (hasNoEditHook(parsed?.hooks)) {
    return { state: 'unchanged', path: settingsPath };
  }
  return { state: 'needsHookMerge', path: settingsPath, current: parsed };
}

// ──────────────────────────────────────────────────────────────
// Diff principal
// ──────────────────────────────────────────────────────────────

/**
 * Compara los skills/rules/scripts/github templates instalados contra los del template actual.
 *
 * **Modelo "workspace files inviolables" (desde 1.1.5):**
 * Los skills/rules/scripts/github del template son la fuente de verdad. Se sobrescriben
 * en cada update sin preguntar — incluso si el dev los editó localmente o los borró.
 * Diff por archivo solo distingue dos categorías:
 *  - `toUpdate`: hash difiere del template upstream (incluye nuevos, actualizados,
 *    customizados, y deleted-by-user — todos terminan rehechos desde el template).
 *  - `unchanged`: el local ya es bit-a-bit igual al upstream.
 *  - `removed`: archivo desapareció del template upstream → se borra del workspace.
 *
 * Archivos locales que NO están en el registry (skills/rules custom del dev) no se
 * listan ni se tocan. El dev puede crear sus propios skills `.claude/skills/<custom>/`
 * sin que el updater los vea ni los moleste.
 *
 * `claudeMd` y `quickStart` se calculan aparte (Handlebars-rendered con contexto
 * persistido — sí preguntan antes de regenerar porque pueden tener notas del proyecto).
 */
export async function computeDiff(workspacePath) {
  const diff = {
    skills:  { toUpdate: [], unchanged: [], removed: [] },
    rules:   { toUpdate: [], unchanged: [], removed: [] },
    scripts: { toUpdate: [], unchanged: [], removed: [] },
    github:  { toUpdate: [], unchanged: [], removed: [] },
    claudeMd: null,
  };

  const installed = readInstalledVersion(workspacePath)
    ?? { skills: {}, rules: {}, scripts: {}, github: {} };

  // ── skills / rules / scripts ──
  for (const kind of ['skills', 'rules', 'scripts']) {
    const srcDir = path.join(TEMPLATES_DIR, kind);
    const dstDir = path.join(workspacePath, '.claude', kind);

    if (!fs.existsSync(srcDir)) continue;

    const filterExt = kind === 'scripts' ? null : '.md';
    const srcFiles = fs.readdirSync(srcDir).filter((f) => !filterExt || f.endsWith(filterExt));
    const srcNames = new Set(srcFiles.map((f) => filterExt ? f.replace(/\.md$/, '') : f));

    // ── removed: archivos en el registry que ya no existen upstream ──
    // Detectamos por registry (autoritativo) y como fallback por listado en disco.
    const registry = installed[kind] ?? {};
    const registeredKeys = new Set(Object.keys(registry));
    for (const key of registeredKeys) {
      const registryName = kind === 'skills' ? key : key.replace(/\.md$/, '');
      if (!srcNames.has(registryName)) {
        diff[kind].removed.push({ file: kind === 'skills' ? `${key}.md` : key, skillName: kind === 'skills' ? key : undefined });
      }
    }
    // Fallback: archivos en disco que no están ni en el registry ni upstream son
    // del usuario (custom) → no los tocamos. Si el archivo está en disco pero NO
    // upstream Y SÍ en registry, ya lo cubrió el bloque de arriba.

    for (const file of srcFiles) {
      const name = filterExt ? file.replace(/\.md$/, '') : file;
      const srcPath = path.join(srcDir, file);
      const dstPath = kind === 'skills'
        ? path.join(dstDir, name, 'SKILL.md')
        : path.join(dstDir, file);
      const srcHash = await hashFile(srcPath);

      if (!fs.existsSync(dstPath)) {
        diff[kind].toUpdate.push({ file, srcHash, reason: 'missing' });
        continue;
      }

      const dstHash = await hashFile(dstPath);
      if (srcHash === dstHash) {
        diff[kind].unchanged.push({ file, srcHash });
      } else {
        diff[kind].toUpdate.push({ file, srcHash, dstHash, reason: 'differs' });
      }
    }
  }

  // ── GitHub templates (planos, sin variables) ──
  const hasGithubDir = fs.existsSync(path.join(workspacePath, '.github'));
  const wasGithubInstalled = !!installed.github && Object.keys(installed.github).length > 0;

  if (hasGithubDir || wasGithubInstalled) {
    const installedGithub = installed.github ?? {};
    const srcKeys = new Set(GITHUB_TEMPLATE_FILES.map((e) => e.dest));

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

      if (!fs.existsSync(dstPath)) {
        diff.github.toUpdate.push({ file: dest, src, srcHash, reason: 'missing' });
        continue;
      }

      const dstHash = await hashFile(dstPath);
      if (srcHash === dstHash) {
        diff.github.unchanged.push({ file: dest, src, srcHash });
      } else {
        diff.github.toUpdate.push({ file: dest, src, srcHash, dstHash, reason: 'differs' });
      }
    }
  }

  // ── settings.json (hook no-edit-without-plan) ──
  diff.settings = diffSettings(workspacePath);

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
 * Aplica los cambios al workspace.
 *
 * Modelo "workspace files inviolables" (1.1.5+): los skills/rules/scripts/github
 * del template se sobrescriben siempre que `selections.workspaceFiles === true`.
 * No hay selección por archivo individual — el dev confirma una vez globalmente
 * o no actualiza. El diff calculado por computeDiff es la fuente.
 *
 * `selections` ahora es:
 *   {
 *     workspaceFiles: bool,  // sobrescribir TODOS los toUpdate + eliminar TODOS los removed
 *     claudeMd:       bool,  // regenerar CLAUDE.md desde Handlebars
 *     quickStart:     bool,  // regenerar docs/QUICK_START.md
 *     settings:       bool,  // mergear hook no-edit-without-plan en settings.json
 *     diff:           object // resultado de computeDiff (necesario para saber qué tocar)
 *   }
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

  const diff = selections.diff;

  try {
    if (selections.workspaceFiles && diff) {
      // ── Eliminar archivos obsoletos ──
      for (const kind of ['skills', 'rules', 'scripts', 'github']) {
        for (const entry of diff[kind].removed) {
          if (kind === 'skills') {
            const skillName = entry.skillName ?? entry.file.replace(/\.md$/, '');
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

      // ── Sobrescribir archivos del template (siempre) ──
      for (const kind of ['skills', 'rules', 'scripts']) {
        for (const entry of diff[kind].toUpdate) {
          const file = entry.file;
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

      for (const entry of diff.github.toUpdate) {
        const tmpl = GITHUB_TEMPLATE_FILES.find((e) => e.dest === entry.file);
        if (!tmpl) continue;
        const srcPath = path.join(TEMPLATES_DIR, tmpl.src);
        const dstPath = path.join(workspacePath, entry.file);
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.copyFileSync(srcPath, dstPath);
        versionData.github[entry.file] = await hashFile(srcPath);
        applied++;
      }
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

    // settings.json — merge del hook no-edit-without-plan preservando lo demás
    if (selections.settings) {
      const settingsPath = path.join(workspacePath, '.claude', 'settings.json');
      let current = {};
      if (fs.existsSync(settingsPath)) {
        try {
          current = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch {
          // Si está corrupto no llegamos aquí (diffSettings devolvió 'corrupt' y
          // selections.settings sería false). Fallback defensivo: dejar vacío.
          current = {};
        }
      }
      const merged = { ...current, hooks: mergeHooks(current.hooks ?? {}) };
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
      applied++;
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
  // Modelo "workspace files inviolables": skills/rules/scripts/github del template
  // siempre se sobrescriben. Resumen muestra qué cambia. Una sola confirmación global.
  const sum = (kind) => ({
    toUpdate: diff[kind].toUpdate.length,
    removed:  diff[kind].removed.length,
    unchanged: diff[kind].unchanged.length,
  });
  const sk = sum('skills');
  const ru = sum('rules');
  const sc = sum('scripts');
  const gh = sum('github');

  const printKind = (label, s) => {
    console.log(chalk.white(`  ${label}:`));
    console.log(chalk.cyan(`    ~ ${s.toUpdate} a sobrescribir desde template`));
    console.log(chalk.red(`    - ${s.removed} obsoleto(s) (se eliminarán)`));
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

  // settings.json (hook no-edit-without-plan)
  console.log(chalk.white('  .claude/settings.json:'));
  const st = diff.settings;
  if (st.state === 'unchanged') {
    console.log(chalk.gray('    · hook no-edit-without-plan ya registrado'));
  } else if (st.state === 'missing') {
    console.log(chalk.green('    + falta — se creará con el hook'));
  } else if (st.state === 'needsHookMerge') {
    console.log(chalk.cyan('    ~ hook no-edit-without-plan no está registrado — se agregará preservando el resto'));
  } else if (st.state === 'corrupt') {
    console.log(chalk.red(`    ✗ archivo corrupto (${st.error}) — arréglalo manualmente, se omitirá`));
  }
  console.log();

  // ── Pendientes / decisión ──
  const workspaceFilesPending = sk.toUpdate + sk.removed + ru.toUpdate + ru.removed +
                                sc.toUpdate + sc.removed + gh.toUpdate + gh.removed;
  const docPending = (state) => state === 'updated' || state === 'customized' || state === 'missing' ? 1 : 0;
  const settingsPending = (state) => state === 'missing' || state === 'needsHookMerge' ? 1 : 0;
  const totalPending =
    workspaceFilesPending +
    docPending(cm.state) + docPending(qs.state) +
    settingsPending(st.state);

  if (totalPending === 0) {
    console.log(chalk.bold.green('✓ Ya estás al día. No hay nada que actualizar.\n'));
    return;
  }

  // Aviso del modelo "inviolable" cuando hay archivos a sobrescribir
  if (workspaceFilesPending > 0) {
    console.log(chalk.yellow(
      '⚠  Los archivos del workspace (skills, rules, scripts, github templates) son\n' +
      '   parte del template y se sobrescribirán completamente. Si tenías cambios\n' +
      '   locales en alguno de esos archivos, los perderás. Tus skills/rules custom\n' +
      '   (no del template) NO se tocan — quedan intactos.\n'
    ));
  }

  const selections = {
    workspaceFiles: false,
    claudeMd:       false,
    quickStart:     false,
    settings:       false,
    diff,
  };

  // Una sola confirmación para sobrescribir todos los archivos del workspace
  if (workspaceFilesPending > 0) {
    selections.workspaceFiles = await confirm({
      message: `Sobrescribir ${workspaceFilesPending} archivo(s) del workspace desde el template?`,
      default: true,
    });
  }

  // CLAUDE.md prompt — sí pregunta caso a caso porque puede tener notas legítimas del proyecto
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

  // settings.json prompt — solo si necesita acción
  if (st.state === 'missing') {
    selections.settings = await confirm({
      message: '.claude/settings.json no existe — ¿crear con el hook no-edit-without-plan?',
      default: true,
    });
  } else if (st.state === 'needsHookMerge') {
    selections.settings = await confirm({
      message: '.claude/settings.json no tiene el hook no-edit-without-plan — ¿agregarlo preservando el resto?',
      default: true,
    });
  }

  // QUICK_START.md prompt — mismo patrón que CLAUDE.md
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
    (selections.workspaceFiles ? workspaceFilesPending : 0) +
    (selections.claudeMd ? 1 : 0) +
    (selections.quickStart ? 1 : 0) +
    (selections.settings ? 1 : 0);

  if (total === 0) {
    console.log(chalk.gray('\nNada seleccionado — saliendo sin cambios.\n'));
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
