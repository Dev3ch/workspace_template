/**
 * updater.js
 * Actualiza los skills y rules de un workspace ya configurado a la última versión
 * publicada de workspace-template, preservando personalizaciones del usuario.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import { execa } from 'execa';
import { confirm, checkbox } from '@inquirer/prompts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const PKG_PATH = path.join(__dirname, '..', 'package.json');

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

/**
 * Compara los skills/rules instalados contra los del template actual.
 * Retorna un diff con entradas: new, updated, unchanged, customized, removed.
 */
export async function computeDiff(workspacePath) {
  const diff = {
    skills:  { new: [], updated: [], unchanged: [], customized: [], removed: [] },
    rules:   { new: [], updated: [], unchanged: [], customized: [], removed: [] },
    scripts: { new: [], updated: [], unchanged: [], customized: [], removed: [] },
  };

  const installed = readInstalledVersion(workspacePath) ?? { skills: {}, rules: {}, scripts: {} };

  for (const kind of ['skills', 'rules', 'scripts']) {
    const srcDir = path.join(TEMPLATES_DIR, kind);
    const dstDir = path.join(workspacePath, '.claude', kind);

    if (!fs.existsSync(srcDir)) continue;

    const filterExt = kind === 'scripts' ? null : '.md';
    const srcFiles = fs.readdirSync(srcDir).filter((f) => !filterExt || f.endsWith(filterExt));
    const srcNames = new Set(srcFiles.map((f) => filterExt ? f.replace(/\.md$/, '') : f));

    // Detectar archivos instalados que ya no existen en el template
    if (fs.existsSync(dstDir)) {
      if (kind === 'skills') {
        const installedDirs = fs.readdirSync(dstDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
        for (const skillName of installedDirs) {
          if (!srcNames.has(skillName)) {
            diff[kind].removed.push({ file: `${skillName}.md`, skillName });
          }
        }
      } else if (kind === 'rules') {
        const installedFiles = fs.readdirSync(dstDir).filter((f) => f.endsWith('.md'));
        for (const file of installedFiles) {
          const ruleName = file.replace(/\.md$/, '');
          if (!srcNames.has(ruleName)) {
            diff[kind].removed.push({ file });
          }
        }
      } else {
        // scripts — todos los archivos, sin filtro de extensión
        const installedFiles = fs.readdirSync(dstDir);
        for (const file of installedFiles) {
          if (!srcNames.has(file)) {
            diff[kind].removed.push({ file });
          }
        }
      }
    }

    for (const file of srcFiles) {
      const name = filterExt ? file.replace(/\.md$/, '') : file;
      const srcPath = path.join(srcDir, file);
      // Skills usan <name>/SKILL.md; rules y scripts usan el archivo tal cual
      const dstPath = kind === 'skills'
        ? path.join(dstDir, name, 'SKILL.md')
        : path.join(dstDir, file);
      const srcHash = await hashFile(srcPath);

      if (!fs.existsSync(dstPath)) {
        diff[kind].new.push({ file, srcHash });
        continue;
      }

      const dstHash = await hashFile(dstPath);
      const originalHash = installed[kind]?.[name] ?? installed[kind]?.[file];

      if (srcHash === dstHash) {
        diff[kind].unchanged.push({ file, srcHash });
      } else if (originalHash && originalHash !== dstHash) {
        diff[kind].customized.push({ file, srcHash, dstHash, originalHash });
      } else {
        diff[kind].updated.push({ file, srcHash, dstHash });
      }
    }
  }

  return diff;
}

/**
 * Aplica los cambios seleccionados al workspace.
 * selections.removed contiene los archivos a eliminar.
 */
export async function applyUpdates(workspacePath, selections) {
  const spinner = ora('Aplicando actualizaciones...').start();
  const versionData = readInstalledVersion(workspacePath) ?? { skills: {}, rules: {} };
  let applied = 0;
  let removed = 0;

  try {
    // Eliminar archivos obsoletos
    for (const kind of ['skills', 'rules', 'scripts']) {
      for (const entry of selections[`${kind}Removed`] ?? []) {
        if (kind === 'skills') {
          const skillName = entry.file.replace(/\.md$/, '');
          const dstDir = path.join(workspacePath, '.claude', kind, skillName);
          if (fs.existsSync(dstDir)) {
            fs.rmSync(dstDir, { recursive: true, force: true });
          }
          delete versionData.skills?.[skillName];
        } else {
          const dstPath = path.join(workspacePath, '.claude', kind, entry.file);
          if (fs.existsSync(dstPath)) fs.unlinkSync(dstPath);
          delete versionData[kind]?.[entry.file];
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
        if (kind === 'scripts' && file.endsWith('.sh')) {
          fs.chmodSync(dstPath, 0o755);
        }

        versionData[kind] ??= {};
        versionData[kind][kind === 'skills' ? skillName : file] = await hashFile(srcPath);
        applied++;
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
 * Se llama después del setup una vez que el usuario elige/crea el project.
 *
 * @param {string} workspacePath
 * @param {{ number: number, url: string, title: string }} projectData
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
 * Lee la configuración del GitHub Project guardada en .workspace-version.
 * @param {string} workspacePath
 * @returns {{ number: number, url: string, title: string } | null}
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

  // Mostrar resumen
  const sum = (kind) => ({
    new: diff[kind].new.length,
    updated: diff[kind].updated.length,
    customized: diff[kind].customized.length,
    removed: diff[kind].removed.length,
    unchanged: diff[kind].unchanged.length,
  });
  const sk = sum('skills');
  const ru = sum('rules');
  const sc = sum('scripts');

  console.log(chalk.bold('Cambios detectados:\n'));
  console.log(chalk.white('  Skills:'));
  console.log(chalk.green(`    + ${sk.new} nuevo(s)`));
  console.log(chalk.cyan(`    ~ ${sk.updated} actualizado(s)`));
  console.log(chalk.yellow(`    ! ${sk.customized} personalizado(s) (tienen cambios locales)`));
  console.log(chalk.red(`    - ${sk.removed} obsoleto(s) (ya no existen en el template)`));
  console.log(chalk.gray(`    · ${sk.unchanged} sin cambios`));
  console.log(chalk.white('\n  Rules:'));
  console.log(chalk.green(`    + ${ru.new} nueva(s)`));
  console.log(chalk.cyan(`    ~ ${ru.updated} actualizada(s)`));
  console.log(chalk.yellow(`    ! ${ru.customized} personalizada(s)`));
  console.log(chalk.red(`    - ${ru.removed} obsoleta(s)`));
  console.log(chalk.gray(`    · ${ru.unchanged} sin cambios`));
  console.log(chalk.white('\n  Scripts:'));
  console.log(chalk.green(`    + ${sc.new} nuevo(s)`));
  console.log(chalk.cyan(`    ~ ${sc.updated} actualizado(s)`));
  console.log(chalk.yellow(`    ! ${sc.customized} personalizado(s)`));
  console.log(chalk.red(`    - ${sc.removed} obsoleto(s)`));
  console.log(chalk.gray(`    · ${sc.unchanged} sin cambios\n`));

  const totalPending =
    sk.new + sk.updated + sk.customized + sk.removed +
    ru.new + ru.updated + ru.customized + ru.removed +
    sc.new + sc.updated + sc.customized + sc.removed;
  if (totalPending === 0) {
    console.log(chalk.bold.green('✓ Ya estás al día. No hay nada que actualizar.\n'));
    return;
  }

  // Preguntar qué aplicar
  const selections = {
    skills: [], rules: [], scripts: [],
    skillsRemoved: [], rulesRemoved: [], scriptsRemoved: [],
  };

  for (const kind of ['skills', 'rules', 'scripts']) {
    const choices = [
      ...diff[kind].new.map((e) => ({
        name: chalk.green(`+ ${e.file}`) + chalk.gray('  (nuevo)'),
        value: e.file,
        checked: true,
      })),
      ...diff[kind].updated.map((e) => ({
        name: chalk.cyan(`~ ${e.file}`) + chalk.gray('  (actualizado upstream)'),
        value: e.file,
        checked: true,
      })),
      ...diff[kind].customized.map((e) => ({
        name: chalk.yellow(`! ${e.file}`) + chalk.gray('  (tienes cambios locales — se sobrescribirán)'),
        value: e.file,
        checked: false,
      })),
    ];

    const removedChoices = diff[kind].removed.map((e) => ({
      name: chalk.red(`- ${e.file}`) + chalk.gray('  (ya no existe en el template — se eliminará)'),
      value: e.file,
      checked: true,
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

  const total =
    selections.skills.length + selections.rules.length + selections.scripts.length +
    selections.skillsRemoved.length + selections.rulesRemoved.length + selections.scriptsRemoved.length;
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
    await execa('git', ['add', '.claude/'], { cwd: resolved });
    await execa('git', ['commit', '-m', `chore(setup): update workspace-template to ${current}`], { cwd: resolved });
    console.log(chalk.green('✓ Cambios commiteados'));
  } catch {
    console.log(chalk.yellow('⚠  No se pudo commitear automáticamente — hazlo manualmente.'));
  }

  console.log(chalk.bold.green(`\n✓ Workspace actualizado a v${current}\n`));
}
