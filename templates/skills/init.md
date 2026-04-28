---
name: init
description: Inicia sesión: lee estado del repo, issues activos y rama actual. Usar al arrancar.
---

# /init

Inicia una sesión de desarrollo. Orienta a Claude sobre el estado actual del proyecto.

## Cuándo invocar

Al inicio de cada sesión de trabajo, antes de empezar cualquier tarea.

## Pasos

### 0. Resolver credenciales de GitHub

```bash
source .claude/scripts/resolve-gh-creds.sh || exit 1
```

El script detecta automáticamente la cuenta con acceso al repo (revisa remote
con creds embebidas, .claude-credentials, keychain del SO, y sesión de `gh`).
Valida el token contra el repo antes de cachear. Si nada funciona, muestra
instrucciones claras.

### 0.5 Posicionarse en `dev` (obligatorio por sesión)

**Regla del workspace:** cada sesión nueva arranca en `dev`. Esto no es una sugerencia
— es la base de trabajo compartida entre features, y las skills siguientes (`/plan`,
`/apply`, `/build`) asumen que estás ahí.

Single-repo:
```bash
git fetch origin --prune

if git ls-remote --heads origin dev | grep -q dev; then
  git checkout dev 2>/dev/null || git checkout -b dev origin/dev
  git pull --ff-only origin dev
else
  echo "⚠  No existe rama dev en remote."
  echo "   Correr /branches para crearla antes de continuar."
  exit 1
fi
```

Multi-repo: aplicar el mismo checkout a **cada repo** listado en el `CLAUDE.md` del
workspace. No dejar ningún repo en `main` o `master` al iniciar la sesión.

```bash
# Ejemplo (iterar sobre los repos del workspace):
for repo in repos/*/; do
  (cd "$repo" && git fetch origin --prune && \
   git checkout dev 2>/dev/null || git checkout -b dev origin/dev && \
   git pull --ff-only origin dev)
done
```

**Excepción mid-chat:** si el dev pide explícitamente trabajar en `main` (ej. hotfix,
pentest, revisión de prod), confirmar una sola vez:

> "`main` es producción — solo hotfixes y auditorías van directo ahí. ¿Continuar?"

Esa decisión **solo dura la sesión actual**. El próximo `/init` volverá a `dev`.

Si `dev` no existe en el remote → invocar `/branches` para crearla y reiniciar `/init`.

### 1. Verificar estado del repo / workspace

```bash
# Estado git (ya en dev)
git status
git log --oneline -10

# Si es multi-repo: verificar cada repo relevante
# git -C <repo-path> status
```

### 1.5 Detectar drift en ramas de work-items locales

Después de actualizar `dev`, comparar cada rama local de work-item contra `origin/dev` para detectar cuáles quedaron atrás (porque otro dev mergeó algo a `dev` mientras esa rama vivía).

```bash
# Listar ramas locales de work-items y medir cuántos commits están atrás de origin/dev
for branch in $(git for-each-ref --format='%(refname:short)' refs/heads/ \
  | grep -E '^(feature|refactor|fix|chore|hotfix)/'); do
  behind=$(git rev-list --count "$branch..origin/dev" 2>/dev/null || echo "?")
  ahead=$(git rev-list --count "origin/dev..$branch" 2>/dev/null || echo "?")
  if [ "$behind" -gt 0 ] 2>/dev/null; then
    echo "  $branch  ($behind commits atrás, $ahead commits propios)"
  fi
done
```

Si hay ramas con drift, mostrarlas al dev y ofrecer sincronizar:

```
⚠  Drift detectado en tus work-items:

  feature/12-sistema-pagos      (5 commits atrás de dev)
  refactor/15-migracion-auth    (2 commits atrás de dev)

¿Quieres sincronizar alguna ahora? [s/N]
```

Si el dev confirma:
- **Default: rebase** (`git rebase origin/dev` en cada rama elegida).
- Si la rama tiene commits ya pusheados que comparte con otro dev → preferir `git merge origin/dev`.
- Tras un rebase exitoso: `git push --force-with-lease origin <rama>` (nunca `--force` puro).
- Si hay conflictos → pausar y pedirle al dev que los resuelva.

Marcar la sesión con `_DRIFT_LAST_CHECK_AT=$(date +%s)` para que las skills posteriores no rechecheen innecesariamente en los próximos 10 minutos.

### 2. Revisar work-items y tasks activas

Los work-items son los issues padre con label `feature`, `refactor`, `fix` o `chore`. Las tasks son sus sub-issues.

```bash
# Work-items en progreso asignados a mí
gh issue list --assignee @me --state open --label "in-progress" \
  --json number,title,labels,url \
  --jq '[.[] | select(.labels[] | .name | IN("feature","refactor","fix","chore"))]'

# Work-items asignados sin label "in-progress" (planificados pero no arrancados)
gh issue list --assignee @me --state open \
  --json number,title,labels,url \
  --jq '[.[] | select((.labels[].name) | IN("feature","refactor","fix","chore"))
              | select(([.labels[].name] | index("in-progress")) | not)]'
```

Para cada work-item en progreso, listar sus tasks abiertas:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      subIssues(first: 50) {
        nodes { number title state labels(first:10){ nodes{ name } } }
      }
    }
  }
}' -f owner="<owner>" -f repo="<repo>" -F number=<PARENT_N>
```

### 3. Revisar PRs abiertos

```bash
gh pr list --author @me --state open --json number,title,url,isDraft
```

### 4. Si se pasa un número de issue

```bash
gh issue view <N> --json title,body,comments,assignees,labels,url
```

### 5. Presentar estado y preguntar al dev qué hacer

Mostrar un resumen claro, agrupado por work-item:

```
=== Estado actual ===
Rama: dev (al día con origin)

Work-items en progreso:
  [FEATURE] #12 — Sistema de pagos con Stripe (feature/12-sistema-pagos-stripe)
    └─ ⏳ #42 — feat: Webhook handler (in-progress)
    └─ □  #43 — feat: Endpoint /payments/intent
    └─ □  #44 — refactor: Extraer cálculo de impuestos

  [REFACTOR] #15 — Migración de auth a sessions
    └─ ✅ #50 — refactor: Eliminar JWT helper
    └─ ⏳ #51 — refactor: Adaptar middleware (in-progress)

Work-items asignados sin empezar:
  [FIX] #20 — Race condition en webhook
  [FEATURE] #25 — Notificaciones push

PRs abiertos:
  #80 — feat: Sistema de pagos (work-item #12) [draft]
```

Luego preguntar explícitamente:

```
¿Qué quieres hacer?
  1. Continuar con un work-item en progreso
  2. Empezar un work-item asignado sin arrancar
  3. Planificar algo nuevo → /plan
  4. Otra cosa
```

Esperar respuesta del dev. No asumir.

### 6. Orientación según la elección

- **Opción 1:** mostrar el work-item, su task activa, verificar que la rama existe y está al día. Indicar el próximo paso concreto.
- **Opción 2:** confirmar arrancar el work-item, crear la rama `<tipo>/<N>-<slug>` desde `dev`, marcar la primera task como `in-progress`.
- **Opción 3:** invocar `/plan` directamente.
- **Opción 4:** escuchar al dev.

## Output esperado

```
=== Sesión iniciada ===
Rama: dev (al día con origin)

Work-items en progreso:
  [FEATURE] #12 — Sistema de pagos con Stripe
    └─ task activa: #42 — feat: Webhook handler

Work-items asignados sin empezar:
  [FIX] #20 — Race condition en webhook

¿Qué quieres hacer?
  1. Continuar con [FEATURE] #12 — task #42
  2. Empezar [FIX] #20
  3. Planificar algo nuevo → /plan
  4. Otra cosa
```

## Siguiente paso

Según la elección del dev:

- **Continuar work-item en progreso** → `/apply` en la rama existente con la task activa
- **Empezar work-item asignado** → `/apply` (crea la rama `<tipo>/<N>-<slug>` desde `dev`)
- **Planificar algo nuevo** → `/plan`
- **Otros devs hicieron cambios recientes** → `/sync` primero, luego volver aquí
- **Hay un PR abierto esperando review** → `/review`
- **No existe rama `dev` en el repo** → `/branches` para normalizar antes de continuar

## Notas

- Si no hay work-items asignados, sugerir revisar el backlog del GitHub Project.
- Nunca asumir contexto de sesiones anteriores — siempre leer desde GitHub.
- **Base por defecto: `dev`.** Cualquier trabajo en `main` requiere confirmación explícita y no persiste entre sesiones.
- Los **work-items** agrupan trabajo coherente (feature, refactor, fix, chore). Las **tasks** son las piezas concretas dentro de un work-item. No hay tasks sin work-item padre.
