#!/usr/bin/env bash
# no-edit-without-plan.sh
#
# Claude Code PreToolUse hook que enforce el guardrail "no editar sin plan"
# documentado en CLAUDE.md. Bloquea edits a código de producción cuando la rama
# actual es una branch protegida (dev / main / staging) o una branch sin
# prefijo conocido de work-item.
#
# Lee JSON del PreToolUse por stdin:
#   { "tool_name": "...", "tool_input": { ... }, ... }
#
# Salida:
#   exit 0 → permite la tool call
#   exit 2 → bloquea, el mensaje en stderr llega al modelo como error
#
# Variables de entorno:
#   CLAUDE_ALLOW_DIRECT_EDIT=1  → bypass de emergencia (queda log en stderr)
#   CLAUDE_PROTECTED_BRANCHES   → override (default: "dev main staging")
#   CLAUDE_WORKITEM_PREFIXES    → override (default: "feature fix refactor chore hotfix")

set -euo pipefail

PROTECTED="${CLAUDE_PROTECTED_BRANCHES:-dev main staging}"
PREFIXES="${CLAUDE_WORKITEM_PREFIXES:-feature fix refactor chore hotfix}"

# ── Leer payload del hook ────────────────────────────────────────────────────
payload="$(cat || true)"
if [[ -z "$payload" ]]; then
  exit 0  # sin payload, no hay nada que verificar
fi

# Extracción tolerante a falta de jq: intentamos jq, si no usamos sed.
extract() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -r "$key // empty" <<<"$payload" 2>/dev/null || true
  else
    # Fallback sin jq — funciona para keys simples top-level.
    # No soporta paths anidados, así que solo se usa para tool_name.
    python3 -c "import sys,json; d=json.load(sys.stdin); ks='$key'.lstrip('.').split('.'); v=d
for k in ks:
  v = v.get(k) if isinstance(v, dict) else None
  if v is None: break
print(v if v is not None else '')" <<<"$payload" 2>/dev/null || true
  fi
}

tool_name="$(extract '.tool_name')"
[[ -z "$tool_name" ]] && exit 0

# Solo nos importan tools que escriben archivos.
case "$tool_name" in
  Edit|MultiEdit|Write|NotebookEdit) ;;
  Bash) ;;
  *) exit 0 ;;
esac

# ── Resolver rama actual ─────────────────────────────────────────────────────
# Si no estamos en un repo git (ej. workspace recién creado, scripts genéricos),
# no bloqueamos — el guardrail solo aplica donde hay flujo de branches.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo "")"
if [[ -z "$branch" ]]; then
  # detached HEAD — bloqueamos por seguridad (probablemente algo inesperado)
  branch="(detached HEAD)"
fi

# ── Bypass de emergencia ─────────────────────────────────────────────────────
if [[ "${CLAUDE_ALLOW_DIRECT_EDIT:-}" == "1" ]]; then
  echo "[no-edit-without-plan] BYPASS active (CLAUDE_ALLOW_DIRECT_EDIT=1) on branch '$branch'" >&2
  exit 0
fi

# ── Determinar paths afectados ───────────────────────────────────────────────
# Para Edit/Write/NotebookEdit: tool_input.file_path
# Para MultiEdit: tool_input.file_path (un solo file)
# Para Bash: tool_input.command — buscamos heuristics de escritura.

paths=()
case "$tool_name" in
  Edit|MultiEdit|Write|NotebookEdit)
    fp="$(extract '.tool_input.file_path')"
    [[ -n "$fp" ]] && paths+=("$fp")
    ;;
  Bash)
    cmd="$(extract '.tool_input.command')"
    [[ -z "$cmd" ]] && exit 0
    # Heurística: buscar redirecciones / herramientas de escritura.
    # Si no hay señal de escritura, dejamos pasar (lectura, build, tests, etc.).
    if ! echo "$cmd" | grep -qE '(>>?[[:space:]]*[^|&;[:space:]]|[[:space:]]tee[[:space:]]|sed[[:space:]]+-i|perl[[:space:]]+-i|python[[:space:]]+-c.*open.*[wa]|cp[[:space:]]|mv[[:space:]]|rm[[:space:]]|mkdir[[:space:]]|touch[[:space:]]|cat[[:space:]]+>)'; then
      exit 0
    fi
    # No intentamos extraer cada path destino — basta saber que el comando
    # escribe en disco. Validamos solo por rama.
    paths+=("<bash-write-command>")
    ;;
esac

# ── Whitelist de paths siempre permitidos ────────────────────────────────────
# Estos archivos son configuración local del flujo, no código de producción.
is_whitelisted_path() {
  local p="$1"
  # Vacío o señal genérica de bash → no path-whitelist
  [[ -z "$p" || "$p" == "<bash-write-command>" ]] && return 1

  # Normalizar a relativo respecto al repo si es absoluto y cae dentro
  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
  if [[ -n "$repo_root" && "$p" == "$repo_root"/* ]]; then
    p="${p#"$repo_root"/}"
  fi

  case "$p" in
    .claude/*|*/.claude/*) return 0 ;;
    CLAUDE.local.md|*/CLAUDE.local.md) return 0 ;;
    .gitignore|*/.gitignore) return 0 ;;
    /tmp/*|/var/tmp/*) return 0 ;;  # archivos temporales fuera del repo
  esac
  return 1
}

# Si TODOS los paths están whitelisteados, dejamos pasar sin chequear rama.
if [[ "$tool_name" != "Bash" ]]; then
  all_whitelisted=true
  for p in "${paths[@]}"; do
    if ! is_whitelisted_path "$p"; then
      all_whitelisted=false
      break
    fi
  done
  $all_whitelisted && exit 0
fi

# ── Chequeo de rama ──────────────────────────────────────────────────────────
# Branch protegida → bloquear.
for protected in $PROTECTED; do
  if [[ "$branch" == "$protected" ]]; then
    cat >&2 <<EOF
⛔ Edit blocked by no-edit-without-plan guardrail.

Current branch: '$branch' (protected — never edit directly).
Tool: $tool_name${paths[0]:+ → ${paths[0]}}

Required flow:
  1. Confirm a work-item with /plan (creates GitHub issue + sub-issues).
  2. /apply will create a work-item branch (feature/N-slug, fix/N-slug, ...).
  3. Edit on the work-item branch.

Bypass for emergencies: set CLAUDE_ALLOW_DIRECT_EDIT=1 (logged to stderr).
Whitelist: edits under .claude/ and CLAUDE.local.md are always allowed.
EOF
    exit 2
  fi
done

# Branch debe matchear un prefijo de work-item.
branch_ok=false
for prefix in $PREFIXES; do
  if [[ "$branch" == "$prefix"/* ]]; then
    branch_ok=true
    break
  fi
done

if ! $branch_ok; then
  cat >&2 <<EOF
⛔ Edit blocked by no-edit-without-plan guardrail.

Current branch: '$branch' — not a recognized work-item branch.
Tool: $tool_name${paths[0]:+ → ${paths[0]}}

Expected branch prefix (one of): $PREFIXES
Format: <prefix>/<issue-number>-<slug>   (e.g. feature/42-add-pagination)

If you are mid-planning, finish /plan first so a work-item branch is created.
Bypass: CLAUDE_ALLOW_DIRECT_EDIT=1.
EOF
  exit 2
fi

exit 0
