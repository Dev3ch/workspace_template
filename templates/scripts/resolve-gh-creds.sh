#!/usr/bin/env bash
# resolve-gh-creds.sh — resuelve GH_TOKEN y GITHUB_USER para skills de Claude Code.
#
# Uso: source .claude/scripts/resolve-gh-creds.sh || exit 1
#
# Después de source, $GH_TOKEN y $GITHUB_USER están validados contra el repo actual.
# Nunca cachea un token que no haya validado con acceso real al repo remoto.

set +x  # evitar leakear token en logs

# ─── helpers ──────────────────────────────────────────────────────────────

_rgc_http_status() {
  # curl silent, devuelve solo el HTTP status code
  local token="$1" url="$2"
  curl -s -o /dev/null -w '%{http_code}' -H "Authorization: token $token" -H 'Accept: application/vnd.github.v3+json' "$url" 2>/dev/null
}

_rgc_validate_token_for_repo() {
  # Valida que el token tenga acceso al repo (pull es suficiente para /init, /sync).
  # Devuelve 0 si OK, 1 si no.
  local token="$1" owner="$2" repo="$3"
  [ -z "$token" ] && return 1
  [ -z "$owner" ] || [ -z "$repo" ] && return 1
  local code
  code=$(_rgc_http_status "$token" "https://api.github.com/repos/$owner/$repo")
  [ "$code" = "200" ]
}

_rgc_user_from_token() {
  local token="$1"
  curl -sf -H "Authorization: token $token" -H 'Accept: application/vnd.github.v3+json' https://api.github.com/user 2>/dev/null | grep -o '"login"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
}

_rgc_save_creds() {
  local user="$1" token="$2" owner="$3" repo="$4"
  {
    echo "GITHUB_USER=$user"
    echo "GH_TOKEN=$token"
    echo "GH_TOKEN_REMOTE=$owner/$repo"
    echo "GH_TOKEN_VERIFIED_AT=$(date +%s)"
  } > .claude-credentials
  chmod 600 .claude-credentials 2>/dev/null || true
  grep -q '^\.claude-credentials$' .gitignore 2>/dev/null || echo '.claude-credentials' >> .gitignore
}

_rgc_read_creds_file() {
  # Lee .claude-credentials y exporta las vars, limpiando \r de Windows
  [ -f .claude-credentials ] || return 1
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      GITHUB_USER=*)           GITHUB_USER="${line#GITHUB_USER=}" ;;
      GH_TOKEN=*)              GH_TOKEN="${line#GH_TOKEN=}" ;;
      GH_TOKEN_REMOTE=*)       _rgc_cached_remote="${line#GH_TOKEN_REMOTE=}" ;;
      GH_TOKEN_VERIFIED_AT=*)  _rgc_cached_ts="${line#GH_TOKEN_VERIFIED_AT=}" ;;
    esac
  done < .claude-credentials
}

_rgc_parse_remote() {
  # Parsea el remote origin a owner/repo. Soporta HTTPS (con o sin creds embebidas) y SSH.
  local url="$1"
  local owner_repo=""
  case "$url" in
    git@github.com:*)          owner_repo="${url#git@github.com:}" ;;
    ssh://git@github.com/*)    owner_repo="${url#ssh://git@github.com/}" ;;
    https://*@github.com/*)    owner_repo="${url#https://*@github.com/}" ;;
    https://github.com/*)      owner_repo="${url#https://github.com/}" ;;
    *)                         return 1 ;;
  esac
  owner_repo="${owner_repo%.git}"
  owner_repo="${owner_repo%/}"
  _rgc_remote_owner="${owner_repo%%/*}"
  _rgc_remote_repo="${owner_repo#*/}"
  [ -n "$_rgc_remote_owner" ] && [ -n "$_rgc_remote_repo" ]
}

_rgc_try_token() {
  # Intenta un token: si es válido para el repo, lo deja en GH_TOKEN/GITHUB_USER y retorna 0.
  local candidate="$1" hint_user="$2"
  [ -z "$candidate" ] && return 1
  if _rgc_validate_token_for_repo "$candidate" "$_rgc_remote_owner" "$_rgc_remote_repo"; then
    GH_TOKEN="$candidate"
    GITHUB_USER="${hint_user:-$(_rgc_user_from_token "$candidate")}"
    return 0
  fi
  return 1
}

# ─── flujo principal ──────────────────────────────────────────────────────

# Obtener remote origin y parsear owner/repo
_rgc_remote_url=$(git remote get-url origin 2>/dev/null)
if [ -z "$_rgc_remote_url" ]; then
  echo "⚠  Este directorio no tiene remote 'origin' configurado."
  echo "   Ejecuta: git remote add origin https://github.com/owner/repo.git"
  return 1 2>/dev/null || exit 1
fi

if ! _rgc_parse_remote "$_rgc_remote_url"; then
  echo "⚠  No se pudo parsear el remote: $_rgc_remote_url"
  return 1 2>/dev/null || exit 1
fi

# 1. Si GH_TOKEN ya viene en el env y es válido, usarlo
if [ -n "$GH_TOKEN" ] && _rgc_validate_token_for_repo "$GH_TOKEN" "$_rgc_remote_owner" "$_rgc_remote_repo"; then
  [ -z "$GITHUB_USER" ] && GITHUB_USER=$(_rgc_user_from_token "$GH_TOKEN")
  export GH_TOKEN GITHUB_USER
  return 0 2>/dev/null || exit 0
fi

# 2. Credenciales embebidas en la URL del remote
_rgc_embedded=$(echo "$_rgc_remote_url" | sed -n 's|^https\?://\([^:]*\):\([^@]*\)@.*|\1 \2|p')
if [ -n "$_rgc_embedded" ]; then
  _rgc_embed_user="${_rgc_embedded%% *}"
  _rgc_embed_token="${_rgc_embedded#* }"
  if _rgc_try_token "$_rgc_embed_token" "$_rgc_embed_user"; then
    _rgc_save_creds "$GITHUB_USER" "$GH_TOKEN" "$_rgc_remote_owner" "$_rgc_remote_repo"
    export GH_TOKEN GITHUB_USER
    return 0 2>/dev/null || exit 0
  fi
fi

# 3. .claude-credentials — PRIORIDAD MÁXIMA sobre cualquier cuenta del sistema.
#    Si el archivo existe y el token tiene acceso al repo, usarlo siempre.
#    Solo se descarta si el token está vacío o ya no tiene acceso (expiró/revocado).
GITHUB_USER=""
GH_TOKEN=""
_rgc_cached_remote=""
_rgc_cached_ts=""
_rgc_read_creds_file

if [ -n "$GH_TOKEN" ]; then
  _rgc_now=$(date +%s)
  _rgc_age=$(( _rgc_now - ${_rgc_cached_ts:-0} ))
  _rgc_current_remote="$_rgc_remote_owner/$_rgc_remote_repo"
  if [ "$_rgc_cached_remote" = "$_rgc_current_remote" ] && [ "$_rgc_age" -lt 604800 ]; then
    # Cache reciente y mismo repo — usar sin revalidar
    export GH_TOKEN GITHUB_USER
    return 0 2>/dev/null || exit 0
  fi
  # Remote distinto o cache viejo — revalidar acceso al repo actual
  if _rgc_validate_token_for_repo "$GH_TOKEN" "$_rgc_remote_owner" "$_rgc_remote_repo"; then
    _rgc_save_creds "$GITHUB_USER" "$GH_TOKEN" "$_rgc_remote_owner" "$_rgc_remote_repo"
    export GH_TOKEN GITHUB_USER
    return 0 2>/dev/null || exit 0
  fi
  # Token expirado o revocado — limpiar y continuar a fuentes del sistema
  GITHUB_USER=""
  GH_TOKEN=""
fi

# 4. git credential fill (keychain/store del sistema) — solo si no hay .claude-credentials válido

# 4. git credential fill (universal: store, osxkeychain, wincred, libsecret)
_rgc_try_credential_fill() {
  local hint_user="$1"
  local filled user pass
  if [ -n "$hint_user" ]; then
    filled=$(printf 'protocol=https\nhost=github.com\nusername=%s\n\n' "$hint_user" | git credential fill 2>/dev/null)
  else
    filled=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null)
  fi
  [ -z "$filled" ] && return 1
  user=$(echo "$filled" | sed -n 's/^username=//p' | head -1)
  pass=$(echo "$filled" | sed -n 's/^password=//p' | head -1)
  _rgc_try_token "$pass" "$user"
}

# Probar candidatos para git credential fill: owner del remote y user.name local del repo.
# No incluir la sesión activa de gh (esa es el último recurso, paso 5).
_rgc_candidates=""
_rgc_candidates="$_rgc_candidates $_rgc_remote_owner"
_rgc_local_user=$(git config --local user.name 2>/dev/null)
[ -n "$_rgc_local_user" ] && _rgc_candidates="$_rgc_candidates $_rgc_local_user"

# Dedup manteniendo orden
_rgc_seen=""
for c in $_rgc_candidates; do
  case " $_rgc_seen " in *" $c "*) continue;; esac
  _rgc_seen="$_rgc_seen $c"
  if _rgc_try_credential_fill "$c"; then
    _rgc_save_creds "$GITHUB_USER" "$GH_TOKEN" "$_rgc_remote_owner" "$_rgc_remote_repo"
    export GH_TOKEN GITHUB_USER
    return 0 2>/dev/null || exit 0
  fi
done

# Sin hint (lo que el helper devuelve por default)
if _rgc_try_credential_fill ""; then
  _rgc_save_creds "$GITHUB_USER" "$GH_TOKEN" "$_rgc_remote_owner" "$_rgc_remote_repo"
  export GH_TOKEN GITHUB_USER
  return 0 2>/dev/null || exit 0
fi

# 5. gh auth token — ÚLTIMO RECURSO. Solo si no hay .claude-credentials ni credential store.
#    Validar que tenga acceso real al repo antes de usarlo para no pisar cuentas incorrectas.
if command -v gh >/dev/null 2>&1; then
  _rgc_gh_token=$(gh auth token 2>/dev/null)
  if [ -n "$_rgc_gh_token" ] && _rgc_try_token "$_rgc_gh_token" ""; then
    _rgc_save_creds "$GITHUB_USER" "$GH_TOKEN" "$_rgc_remote_owner" "$_rgc_remote_repo"
    export GH_TOKEN GITHUB_USER
    return 0 2>/dev/null || exit 0
  fi
fi

# 6. Nada funcionó — mensaje accionable
cat <<EOF
⚠  No se detectó una cuenta con acceso al repo $_rgc_remote_owner/$_rgc_remote_repo.

   Fuentes consultadas sin éxito:
   - Credenciales embebidas en remote.origin.url
   - .claude-credentials (cache local)
   - git credential fill (keychain/store del sistema)
   - gh auth token (sesión activa)

   Opciones:
   a) Configura gh CLI con una cuenta invitada al repo:
        gh auth login
   b) Crea .claude-credentials manualmente con un token de una cuenta
      que tenga acceso a $_rgc_remote_owner/$_rgc_remote_repo:
        GITHUB_USER=tu-usuario
        GH_TOKEN=ghp_...
   c) Si clonaste con otra cuenta, reintenta el clone usando esa:
        git clone https://<user>:<token>@github.com/$_rgc_remote_owner/$_rgc_remote_repo.git

   Si ya tienes una cuenta configurada pero no es la que tiene acceso al repo,
   es posible que no hayas sido invitado. Contacta al owner del repositorio.
EOF
return 1 2>/dev/null || exit 1
