import { execSync } from 'child_process';
import os from 'os';

/**
 * Detecta el sistema operativo actual.
 * @returns {'linux'|'macos'|'windows'|'unknown'}
 */
export function detectOS() {
  const platform = os.platform();
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'unknown';
}

/**
 * Verifica si un comando existe en el PATH.
 * @param {string} cmd
 * @returns {boolean}
 */
export function commandExists(cmd) {
  try {
    const check = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Retorna instrucciones de instalación por OS para una herramienta.
 * @param {'git'|'gh'|'node'} tool
 * @param {'linux'|'macos'|'windows'|'unknown'} osName
 * @returns {string[]} líneas de instrucciones
 */
export function installInstructions(tool, osName) {
  const instructions = {
    git: {
      linux: [
        'Ubuntu/Debian:  sudo apt update && sudo apt install git',
        'Fedora/RHEL:    sudo dnf install git',
        'Arch:           sudo pacman -S git',
      ],
      macos: [
        'Homebrew:  brew install git',
        'Si no tienes Homebrew:  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
      ],
      windows: [
        'winget:    winget install Git.Git',
        'Manual:    https://git-scm.com/download/win',
      ],
      unknown: ['Descarga desde: https://git-scm.com/downloads'],
    },
    gh: {
      linux: [
        'Ubuntu/Debian:',
        '  (type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y))',
        '  sudo mkdir -p -m 755 /etc/apt/keyrings',
        '  wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null',
        '  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
        '  sudo apt update && sudo apt install gh',
        'O con brew: brew install gh',
      ],
      macos: [
        'Homebrew:  brew install gh',
      ],
      windows: [
        'winget:    winget install GitHub.cli',
        'Manual:    https://cli.github.com',
      ],
      unknown: ['Descarga desde: https://cli.github.com'],
    },
    node: {
      linux: [
        'nvm (recomendado):  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
        '                    nvm install --lts',
        'Ubuntu/Debian:      sudo apt update && sudo apt install nodejs npm',
      ],
      macos: [
        'nvm (recomendado):  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash',
        '                    nvm install --lts',
        'Homebrew:           brew install node',
      ],
      windows: [
        'winget:  winget install OpenJS.NodeJS.LTS',
        'Manual:  https://nodejs.org',
      ],
      unknown: ['Descarga desde: https://nodejs.org'],
    },
  };

  return instructions[tool]?.[osName] ?? instructions[tool]?.unknown ?? ['Ver: https://google.com/' + tool];
}

/**
 * Ejecuta la verificación completa del entorno.
 * @returns {{ os: string, missing: string[], present: string[] }}
 */
export function checkEnvironment() {
  const detectedOS = detectOS();
  const tools = ['git', 'gh', 'node'];
  const present = [];
  const missing = [];

  for (const tool of tools) {
    if (commandExists(tool)) {
      present.push(tool);
    } else {
      missing.push(tool);
    }
  }

  return { os: detectedOS, missing, present };
}
