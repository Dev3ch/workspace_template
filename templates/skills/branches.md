---
name: branches
description: Audita y normaliza el modelo de branches del repo (main + dev obligatorio, staging opcional).
---

# /branches

Audita el modelo de branches del repo actual y lo alinea con la regla del workspace:
`main` como producción, `dev` obligatoria como base de integración, `staging` opcional
para flujos con QA previo.

Invocala cuando:
- Incorporaste un repo nuevo y no corriste el normalizador del setup.
- Un repo solo tiene `master` y quieres migrarlo a `main`.
- Tu repo no tiene `dev` y quieres crearla sin configurarla a mano.
- Ya tienes `dev` pero quieres añadir `staging` ahora que el proyecto creció.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Modelo objetivo

| Rama | Rol | ¿Obligatoria? |
|---|---|---|
| `main` | Producción — solo recibe merges desde `staging` o hotfixes. | Sí (puede llamarse `master` legacy) |
| `dev` | Integración — base de todas las ramas de work-items (`feature/*`, `refactor/*`, `fix/*`, `chore/*`). | **Sí, siempre.** |
| `staging` | Pre-producción / QA. | Opcional — preguntar al dev. |

## Pasos

### 1. Detectar estado actual

```bash
# Refrescar refs remotas
git fetch origin --prune

# Branch default del repo en GitHub
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
DEFAULT_BRANCH=$(gh api "repos/$OWNER/$REPO" --jq '.default_branch')

# ¿Existen dev y staging en remote?
git ls-remote --heads origin dev
git ls-remote --heads origin staging

echo "Default: $DEFAULT_BRANCH"
```

### 2. Si default es `master` — ofrecer rename a `main`

Preguntar al dev:
> "Tu repo usa `master` como branch principal. El estándar actual es `main`. ¿Renombrar?"

Si sí:
```bash
gh api -X POST "repos/$OWNER/$REPO/branches/master/rename" -f new_name=main
git fetch origin
git remote set-head origin main
git branch -m master main 2>/dev/null || true
git branch -u origin/main main 2>/dev/null || true
```

Si falla por permisos → informar al dev, **no bloquear**. Seguir con `master` como base de `dev`.

Si no: seguir con `master` como base — funciona igual.

### 3. Crear `dev` si no existe (obligatorio)

```bash
# Si `git ls-remote --heads origin dev` no devolvió nada:
git branch dev "origin/$DEFAULT_BRANCH"
git push -u origin dev
```

Si ya existe → respetarla tal cual. No renombrar ni recrear.

### 4. `staging` — preguntar (opcional)

Solo si no existe:
> "¿Quieres crear también la rama `staging`? Es útil si haces QA antes de producción. Default: no."

Si sí:
```bash
git branch staging "origin/$DEFAULT_BRANCH"
git push -u origin staging
```

### 5. Posicionar el repo local en `dev`

Al terminar, dejar el working tree en `dev` para que el dev siga trabajando:

```bash
git checkout dev 2>/dev/null || git checkout -b dev origin/dev
git pull origin dev
```

### 6. Multi-repo

Si el workspace tiene varios repos (revisa `CLAUDE.md` del root), aplicar este flujo
a **cada uno**. Respeta el principio: `dev` es obligatoria en todos los repos del
workspace para que el flujo entre ellos sea coherente.

## Output esperado

```
=== /branches — Reporte ===
Repo: mi-org/mi-repo
Default: main (sin cambios)

Acciones:
  ✓ dev creada desde main
  · staging omitida (el dev eligió no crearla)

Rama actual: dev
```

## Siguiente paso

- **Branches normalizadas, repo listo** → `/init` (orienta la sesión sobre `dev`)
- **Hay código en `main` que debería estar en `dev`** → hacer `dev` el upstream de `main` ahora mismo (tras la creación, `dev` ya es réplica de `main`)
- **El usuario quiere trabajar directo en `main`** → confirmar explícitamente; recordar que el estándar es `dev` y la siguiente sesión volverá a `dev`.
- **Multi-repo, algunos repos no se normalizaron** → re-ejecutar `/branches` en cada uno

## Notas

- **`dev` no es negociable.** Si el dev no quiere `dev`, es mejor no usar este workspace — su flujo asume la promoción `<work-item-branch>/* → dev → staging/main`.
- **No cambiar la branch default del repo en GitHub** desde esta skill. Eso es decisión de admins del repo y puede romper CI, integraciones y protection rules.
- **Protection rules** (require PR, 1 approval, no force-push) no se configuran aquí — se documentan en `.claude/rules/branching.md`. Si el equipo quiere aplicarlas programáticamente, hacerlo en un paso separado con `gh api repos/{o}/{r}/branches/{b}/protection`.
- Si el repo está vacío (sin commits), `dev` no se puede crear hasta después del primer push.
