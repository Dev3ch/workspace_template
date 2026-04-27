/**
 * env-bootstrap.js
 * Detecta herramientas instaladas y guía al usuario con comandos de instalación.
 * NUNCA instala automáticamente — solo muestra comandos.
 */

import { execSync } from 'child_process';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { detectOS } from './detect-env.js';

// ──────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────

/**
 * Ejecuta un comando y devuelve su salida, o null si falla.
 * @param {string} cmd
 * @returns {string|null}
 */
function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Verifica si un comando existe en el PATH.
 * @param {string} cmd
 * @returns {boolean}
 */
function commandExists(cmd) {
  const check = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
  return tryExec(check) !== null;
}

// ──────────────────────────────────────────────────────────────
// Comandos de instalación por herramienta y OS
// ──────────────────────────────────────────────────────────────

const INSTALL_COMMANDS = {
  nvm: {
    linux:   'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
    macos:   'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
    windows: '# nvm-windows: https://github.com/coreybutler/nvm-windows/releases',
    unknown: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
  },
  node: {
    linux:   'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs',
    macos:   'brew install node@22',
    windows: 'winget install OpenJS.NodeJS.LTS',
    unknown: '# Descarga desde: https://nodejs.org',
  },
  'node-via-nvm': {
    linux:   'nvm install 22 && nvm use 22 && nvm alias default 22',
    macos:   'nvm install 22 && nvm use 22 && nvm alias default 22',
    windows: 'nvm install 22 && nvm use 22',
    unknown: 'nvm install 22 && nvm use 22 && nvm alias default 22',
  },
  python3: {
    linux:   'sudo apt install python3.12 python3.12-venv',
    macos:   'brew install python@3.12',
    windows: 'winget install Python.Python.3.12',
    unknown: '# Descarga desde: https://www.python.org/downloads/',
  },
  uv: {
    linux:   'curl -LsSf https://astral.sh/uv/install.sh | sh',
    macos:   'curl -LsSf https://astral.sh/uv/install.sh | sh',
    windows: 'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"',
    unknown: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
  },
  git: {
    linux:   'sudo apt update && sudo apt install git',
    macos:   'brew install git',
    windows: 'winget install Git.Git',
    unknown: '# Descarga desde: https://git-scm.com/downloads',
  },
  gh: {
    linux:   'sudo apt install gh  # o: brew install gh',
    macos:   'brew install gh',
    windows: 'winget install GitHub.cli',
    unknown: '# Descarga desde: https://cli.github.com',
  },
  docker: {
    linux:   'curl -fsSL https://get.docker.com | sh',
    macos:   'brew install --cask docker',
    windows: '# Descarga Docker Desktop: https://www.docker.com/products/docker-desktop',
    unknown: '# Descarga desde: https://docs.docker.com/get-docker/',
  },
};

// ──────────────────────────────────────────────────────────────
// Detección de herramientas
// ──────────────────────────────────────────────────────────────

/**
 * Detecta la versión de un comando, o null si no está instalado.
 * @param {string} tool
 * @returns {{ found: boolean, version: string|null }}
 */
function detectTool(tool) {
  switch (tool) {
    case 'nvm': {
      // nvm es una función de shell, no un binario — verificar el directorio
      const nvmDir = process.env.NVM_DIR ?? `${process.env.HOME}/.nvm`;
      const found = tryExec(`test -s "${nvmDir}/nvm.sh" && echo yes`) === 'yes'
        || commandExists('nvm');
      // Intentar obtener versión vía script si existe
      const version = tryExec(`bash -c 'source "${nvmDir}/nvm.sh" 2>/dev/null && nvm --version 2>/dev/null'`);
      return { found: found || version !== null, version };
    }
    case 'node': {
      const found = commandExists('node');
      const version = found ? tryExec('node --version') : null;
      return { found, version };
    }
    case 'python3': {
      const found = commandExists('python3') || commandExists('python');
      const version = found
        ? (tryExec('python3 --version') ?? tryExec('python --version'))
        : null;
      return { found, version };
    }
    case 'uv': {
      const found = commandExists('uv');
      const version = found ? tryExec('uv --version') : null;
      return { found, version };
    }
    case 'git': {
      const found = commandExists('git');
      const version = found ? tryExec('git --version') : null;
      return { found, version };
    }
    case 'gh': {
      const found = commandExists('gh');
      const version = found ? tryExec('gh --version') : null;
      return { found, version: version?.split('\n')[0] ?? null };
    }
    case 'docker': {
      const found = commandExists('docker');
      const version = found ? tryExec('docker --version') : null;
      // También verificar docker compose (v2)
      const hasCompose = found && tryExec('docker compose version') !== null;
      return {
        found,
        version,
        extra: hasCompose ? 'docker compose ✓' : 'docker compose no encontrado',
      };
    }
    default:
      return { found: false, version: null };
  }
}

// ──────────────────────────────────────────────────────────────
// Tabla de estado
// ──────────────────────────────────────────────────────────────

const TOOL_DESCRIPTIONS = {
  nvm:     'Node Version Manager',
  node:    'Node.js runtime',
  python3: 'Python 3',
  uv:      'Python package manager (moderno)',
  git:     'Control de versiones',
  gh:      'GitHub CLI',
  docker:  'Docker + Docker Compose',
};

const TOOLS_TO_CHECK = ['nvm', 'node', 'python3', 'uv', 'git', 'gh', 'docker'];

/**
 * Detecta todas las herramientas y devuelve un resumen.
 * @returns {{ os: string, tools: Array<{name, found, version, installCmd, description}> }}
 */
export function detectAllTools() {
  const osName = detectOS();
  const tools = TOOLS_TO_CHECK.map((name) => {
    const { found, version, extra } = detectTool(name);
    const installCmd = INSTALL_COMMANDS[name]?.[osName] ?? INSTALL_COMMANDS[name]?.unknown ?? '—';
    return {
      name,
      description: TOOL_DESCRIPTIONS[name] ?? name,
      found,
      version: version ? version.replace(/\n.*$/s, '') : null,
      extra: extra ?? null,
      installCmd,
    };
  });
  return { os: osName, tools };
}

// ──────────────────────────────────────────────────────────────
// Renderizado de tabla
// ──────────────────────────────────────────────────────────────

/**
 * Imprime la tabla de herramientas en consola.
 * @param {ReturnType<typeof detectAllTools>} result
 */
export function printToolsTable({ tools }) {
  const COL_TOOL = 10;
  const COL_DESC = 36;
  const COL_STATUS = 12;
  const COL_VERSION = 30;

  const hr = chalk.gray('─'.repeat(COL_TOOL + COL_DESC + COL_STATUS + COL_VERSION + 10));

  // Cabecera
  console.log(hr);
  console.log(
    chalk.bold(
      pad('Herramienta', COL_TOOL) +
      pad('Descripción', COL_DESC) +
      pad('Estado', COL_STATUS) +
      'Versión / Comando de instalación'
    )
  );
  console.log(hr);

  for (const tool of tools) {
    const toolCol = pad(tool.name, COL_TOOL);
    const descCol = pad(tool.description, COL_DESC);

    if (tool.found) {
      const statusCol = chalk.green(pad('✓ instalado', COL_STATUS));
      const versionCol = chalk.gray(tool.version ?? '—');
      const extraLine = tool.extra ? chalk.gray(`  ${' '.repeat(COL_TOOL + COL_DESC + COL_STATUS)}${tool.extra}`) : '';
      console.log(toolCol + descCol + statusCol + versionCol);
      if (extraLine) console.log(extraLine);
    } else {
      const statusCol = chalk.red(pad('✗ falta', COL_STATUS));
      const cmdCol = chalk.yellow(tool.installCmd);
      console.log(toolCol + descCol + statusCol + cmdCol);
    }

    // Recomendación especial de versión
    if (tool.name === 'node' && tool.found && tool.version) {
      const major = parseInt(tool.version.replace('v', ''), 10);
      if (!isNaN(major) && major < 22) {
        console.log(
          chalk.yellow(`  ${''.padEnd(COL_TOOL + COL_DESC + COL_STATUS)}⚠  Se recomienda Node 22 LTS`)
        );
        const osName = detectOS();
        const nvmCmd = INSTALL_COMMANDS['node-via-nvm']?.[osName];
        if (nvmCmd) {
          console.log(chalk.gray(`  ${''.padEnd(COL_TOOL + COL_DESC + COL_STATUS)}${nvmCmd}`));
        }
      }
    }

    if (tool.name === 'python3' && tool.found && tool.version) {
      const match = tool.version.match(/(\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major < 3 || (major === 3 && minor < 12)) {
          console.log(
            chalk.yellow(`  ${''.padEnd(COL_TOOL + COL_DESC + COL_STATUS)}⚠  Se recomienda Python 3.12`)
          );
        }
      }
    }
  }

  console.log(hr);
}

function pad(str, len) {
  return (str ?? '').padEnd(len).slice(0, len);
}

// ──────────────────────────────────────────────────────────────
// Flujo principal
// ──────────────────────────────────────────────────────────────

/**
 * Ejecuta el bootstrap de entorno:
 * detecta herramientas, imprime tabla y pregunta si continuar.
 *
 * @returns {{ os: string, tools: object[], wantsToContinue: boolean }}
 */
export async function runEnvBootstrap() {
  console.log(chalk.bold('\nVerificando herramientas del entorno...\n'));

  const result = detectAllTools();
  printToolsTable(result);

  const missing = result.tools.filter((t) => !t.found);

  if (missing.length > 0) {
    console.log(chalk.yellow(`\n⚠  ${missing.length} herramienta(s) no encontrada(s).`));
    console.log(chalk.gray('  Copia los comandos de la tabla y ejecútalos en otra terminal.\n'));
  } else {
    console.log(chalk.green('\n✓ Todas las herramientas están instaladas.\n'));
  }

  const wantsToContinue = await confirm({
    message: '¿Quieres continuar con las herramientas actuales?',
    default: true,
  });

  return { ...result, wantsToContinue };
}
