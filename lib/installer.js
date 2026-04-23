import chalk from 'chalk';
import { installInstructions } from './detect-env.js';

/**
 * Muestra las instrucciones de instalación para las herramientas faltantes
 * y espera a que el usuario las instale.
 *
 * @param {string[]} missingTools  - herramientas que faltan ['git', 'gh', ...]
 * @param {string}   osName        - sistema operativo detectado
 * @param {Function} pressEnter    - función para esperar confirmación del usuario
 */
export async function showInstallInstructions(missingTools, osName, pressEnter) {
  if (missingTools.length === 0) return;

  console.log(chalk.yellow(`\n⚠️  Faltan ${missingTools.length} herramienta(s) requerida(s):\n`));

  for (const tool of missingTools) {
    console.log(chalk.bold.red(`  ✗ ${tool}`));
    const lines = installInstructions(tool, osName);
    for (const line of lines) {
      console.log(chalk.gray(`    ${line}`));
    }
    console.log('');
  }

  console.log(chalk.cyan('Por favor instala las herramientas faltantes y luego continúa.'));
  await pressEnter('Presiona Enter cuando hayas instalado todas las herramientas...');
}

/**
 * Muestra las herramientas presentes de forma positiva.
 * @param {string[]} presentTools
 */
export function showPresentTools(presentTools) {
  for (const tool of presentTools) {
    console.log(chalk.green(`  ✓ ${tool}`));
  }
}
