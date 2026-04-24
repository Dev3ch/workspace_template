---
name: build
description: Commit + push + comenta progreso en el issue activo. Usar al cerrar sesión o terminar una tarea.
---

# /build

Guarda el progreso de la sesión en GitHub y hace push del trabajo.

## Credenciales de GitHub

```bash
source .claude/scripts/resolve-gh-creds.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

Al final de cada sesión de trabajo, o cuando el dev pide guardar progreso.

## Pasos

### 1. Revisar cambios actuales

```bash
git status
git diff --stat
```

### 2. Hacer commit de los cambios pendientes

Si hay cambios sin commitear, hacer commit con mensaje descriptivo:

```bash
git add <archivos-relevantes>
git commit -m "wip(scope): descripción del progreso #N"
```

### 3. Push

```bash
git push origin <branch-actual>
```

Si el branch no tiene upstream:
```bash
git push -u origin <branch-actual>
```

### 3.5 Ofrecer abrir PR contra `dev`

Si el branch actual es `feat/*`, `fix/*` o `chore/*` y aún no hay PR abierto,
preguntar al dev si crear uno ya. La base es **siempre `dev`** (los PR hacia
`staging` o `main` son promociones, no features).

```bash
BRANCH=$(git branch --show-current)
EXISTING_PR=$(gh pr list --head "$BRANCH" --base dev --json number --jq '.[0].number')

if [ -z "$EXISTING_PR" ] && echo "$BRANCH" | grep -qE '^(feat|fix|chore)/'; then
  # Preguntar al dev si quiere abrir el PR ahora
  gh pr create --base dev --head "$BRANCH" \
    --title "feat: <título del issue> (#<N>)" \
    --body "Closes #<N>

## Resumen
- <1-3 bullets del cambio>

## Test plan
- [ ] <qué probar>"
fi
```

Si ya existe PR → solo agregar un comentario con el progreso de esta sesión.

Si son **múltiples** cambios en repos distintos (multi-repo), abrir un PR por
repo — nunca consolidar repos distintos en un solo PR. Si los cambios de un
mismo repo corresponden a issues distintos, también van en PRs separados
(un issue = un branch = un PR por repo).

### 4. Actualizar el issue con el progreso

Crear un comment en el issue activo con:
- Qué se hizo en esta sesión
- Estado actual (qué falta)
- Próximo paso para la siguiente sesión
- Links a commits o archivos modificados relevantes

```bash
gh issue comment <N> --body "$(cat <<'EOF'
## Progreso sesión $(date +%Y-%m-%d)

**Hecho:**
- [descripción de lo implementado]

**Estado:** [En progreso / Listo para review / Bloqueado por X]

**Próximo paso:**
- [qué hacer en la siguiente sesión]

**Archivos modificados:**
- [lista de archivos clave]
EOF
)"
```

### 5. Actualizar board (si aplica)

Si el issue está listo para review:
```bash
# Mover issue a "In Review" en el project board
gh issue edit <N> --add-label "review"
```

## Siguiente paso

- **Feature completa, PR listo para revisar** → `/review`
- **Feature completa y va a main/staging** → `/secure` (pre-deploy) → `/deploy`
- **Trabajo en progreso, continuar mañana** → `/init` en la próxima sesión
- **Trabajo afecta otros repos del workspace** → `/cross` para coordinar

## Notas

- Nunca guardar progreso en archivos locales fuera del repo.
- Si el trabajo está en varios repos, hacer push en todos.
- Un comment por sesión, no spam de comments — editar el último si la sesión sigue.
