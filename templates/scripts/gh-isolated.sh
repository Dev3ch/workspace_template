#!/usr/bin/env bash
# gh-isolated.sh — fuerza a `gh` y a las skills a usar el token de
# .claude-credentials, ignorando el keyring del SO.
#
# Uso (siempre al inicio de cada Bash call de una skill):
#   source .claude/scripts/gh-isolated.sh || exit 1
#
# Después de source:
#   - GH_TOKEN, GITHUB_USER están exportados desde .claude-credentials.
#   - GH_CONFIG_DIR apunta a un dir efímero de la sesión, donde `gh` cree
#     que está logueado solo como $GITHUB_USER. El keyring del SO queda fuera.
#   - GH_REPO está seteado a "<owner>/<repo>" del remote actual.
#   - REPO_OWNER y REPO_NAME están separados.
#
# Razón: cada Bash call es un proceso nuevo, y `gh` por defecto prefiere el
# keyring del sistema sobre $GH_TOKEN. Esto causa 404s en repos privados cuando
# el keyring tiene una cuenta distinta a la del workspace. Sourcing este
# script al inicio de cada call elimina el problema de raíz.

set +x  # nunca leakear token

# ─── 1. Cargar token validado ─────────────────────────────────────────────

if ! source .claude/scripts/resolve-gh-creds.sh; then
  echo "✗ No se pudo resolver credenciales para este repo." >&2
  return 1 2>/dev/null || exit 1
fi

if [ -z "$GH_TOKEN" ] || [ -z "$GITHUB_USER" ]; then
  echo "✗ resolve-gh-creds.sh no exportó GH_TOKEN/GITHUB_USER." >&2
  return 1 2>/dev/null || exit 1
fi

# ─── 2. Parsear remote para tener REPO_OWNER/REPO_NAME ────────────────────

_gi_remote=$(git remote get-url origin 2>/dev/null)
case "$_gi_remote" in
  git@github.com:*)        _gi_or="${_gi_remote#git@github.com:}" ;;
  ssh://git@github.com/*)  _gi_or="${_gi_remote#ssh://git@github.com/}" ;;
  https://*@github.com/*)  _gi_or="${_gi_remote#https://*@github.com/}" ;;
  https://github.com/*)    _gi_or="${_gi_remote#https://github.com/}" ;;
  *) echo "✗ remote origin no es de github.com: $_gi_remote" >&2
     return 1 2>/dev/null || exit 1 ;;
esac
_gi_or="${_gi_or%.git}"
_gi_or="${_gi_or%/}"
REPO_OWNER="${_gi_or%%/*}"
REPO_NAME="${_gi_or#*/}"
GH_REPO="$REPO_OWNER/$REPO_NAME"

# ─── 3. GH_CONFIG_DIR efímero por sesión, con hosts.yml apuntando a Dev3ch ─

# Reusar el dir si ya fue creado en esta sesión (mismo usuario y mismo repo).
_gi_config_dir="${TMPDIR:-/tmp}/claude-gh-${USER}-${GITHUB_USER}-${REPO_OWNER}"
if [ ! -d "$_gi_config_dir" ]; then
  mkdir -p "$_gi_config_dir"
  chmod 700 "$_gi_config_dir"
fi

cat > "$_gi_config_dir/hosts.yml" <<EOF
github.com:
    oauth_token: $GH_TOKEN
    user: $GITHUB_USER
    git_protocol: https
EOF
chmod 600 "$_gi_config_dir/hosts.yml"

export GH_CONFIG_DIR="$_gi_config_dir"
export GH_TOKEN GITHUB_USER GH_REPO REPO_OWNER REPO_NAME

# ─── 4. Sanity check rápido contra el repo (1 sola llamada, no por cada gh) ─

# Si falla aquí, paramos en seco. Evita las "ocho vueltas" de improvisación.
_gi_code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$GH_REPO" 2>/dev/null)

if [ "$_gi_code" != "200" ]; then
  cat >&2 <<EOF
✗ El token de .claude-credentials (usuario: $GITHUB_USER) no tiene acceso a $GH_REPO.
  HTTP $_gi_code de GitHub.

  No voy a improvisar otras fuentes. Revisa .claude-credentials o regenera el token
  con scopes 'repo' y SSO autorizado para el org si aplica.
EOF
  return 1 2>/dev/null || exit 1
fi

unset _gi_remote _gi_or _gi_config_dir _gi_code
