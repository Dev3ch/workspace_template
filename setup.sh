#!/usr/bin/env bash
# setup.sh — Entrypoint para workspace-template
# Verifica que node esté instalado y delega al CLI principal

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Verificar node
if ! command -v node &>/dev/null; then
  echo "❌ Node.js no está instalado."
  echo ""
  echo "Instalación:"
  case "$(uname -s)" in
    Linux*)
      echo "  Ubuntu/Debian: sudo apt install nodejs npm"
      echo "  O via nvm:     curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
      ;;
    Darwin*)
      echo "  macOS: brew install node"
      echo "  O via nvm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
      ;;
    CYGWIN*|MINGW*|MSYS*)
      echo "  Windows: winget install OpenJS.NodeJS"
      echo "  O descarga desde: https://nodejs.org"
      ;;
  esac
  exit 1
fi

# Instalar dependencias si no están
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "📦 Instalando dependencias..."
  cd "$SCRIPT_DIR" && npm install
fi

# Ejecutar CLI
node "$SCRIPT_DIR/bin/workspace-template.js" "$@"
