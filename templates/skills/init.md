---
name: init
description: Inicia sesión: lee estado del repo, issues activos y rama actual. Usar al arrancar.
---

# /init

Inicia una sesión de desarrollo. Orienta a Claude sobre el estado actual del proyecto.

## Cuándo invocar

Al inicio de cada sesión de trabajo, antes de empezar cualquier tarea.

## Pasos

### 0. Resolver credenciales de GitHub (fail-fast)

**Una sola llamada, sin improvisar.** Cada Bash call de cualquier skill empieza con:

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Esto:
- Carga `.claude-credentials` (prioridad máxima sobre el keyring del SO).
- Aísla `gh` con `GH_CONFIG_DIR` efímero, así `gh` ignora cualquier sesión del keyring que tenga otra cuenta.
- Valida el token contra el repo con UN solo `curl`. Si falla → para de inmediato.
- Exporta `GH_TOKEN`, `GITHUB_USER`, `GH_REPO`, `REPO_OWNER`, `REPO_NAME`.

**Regla dura:** si `gh-isolated.sh` falla, **no intentar arreglar credenciales de mil formas distintas**. Reportar el error al dev tal cual y parar. Las instrucciones para arreglarlo están en el output del propio script. No probar `gh auth switch`, ni `mktemp` configs paralelos, ni `gh auth login --with-token`. El dev arregla `.claude-credentials` y vuelve a correr.

**Recordatorio importante:** cada Bash call es un proceso nuevo y las exports se pierden. **Toda Bash call de una skill debe empezar con `source .claude/scripts/gh-isolated.sh`** (es idempotente y reusa el `GH_CONFIG_DIR` de la sesión, así que no es caro).

### 0.5 Posicionarse en `dev` (obligatorio por sesión)

**Regla del workspace:** cada sesión nueva arranca en `dev`. Esto no es una sugerencia
— es la base de trabajo compartida entre features, y las skills siguientes (`/plan`,
`/apply`, `/build`) asumen que estás ahí.

**ANTES de cualquier checkout: chequear el estado de la rama actual.** No moverse
ciegamente. La regla es:

1. **Detectar rama actual y cambios pendientes** (single-repo o por cada repo en multi-repo):

   ```bash
   CURRENT_BRANCH=$(git branch --show-current)
   DIRTY=$(git status --porcelain)              # vacío = working tree limpio
   UNPUSHED=$(git log --oneline @{u}..HEAD 2>/dev/null || echo "")  # commits locales sin push
   ```

2. **Decidir según los tres casos posibles:**

   **Caso A — Ya estás en `dev`:** simplemente `git pull --ff-only origin dev`. No hay decisión que tomar.

   **Caso B — Estás en otra rama, working tree limpio y sin commits locales sin push:**
   moverte a `dev` directo. No hay riesgo de perder trabajo.

   ```bash
   git fetch origin --prune
   git checkout dev 2>/dev/null || git checkout -b dev origin/dev
   git pull --ff-only origin dev
   ```

   **Caso C — Estás en otra rama y hay cambios pendientes** (working tree sucio
   **o** commits locales sin push). **NO moverse.** Avisar al dev y pedir decisión:

   ```
   ⚠  Estás en `feature/12-pagos` y tienes trabajo sin guardar:

      Cambios sin commitear:
        M apps/payments/views.py
        A tests/payments/test_webhook.py

      Commits locales sin push:
        a1b2c3d feat(payments): webhook handler
        e4f5g6h test(payments): casos de error

   Para arrancar la sesión en `dev` sin perder tu trabajo, una de estas:

     1. Commitear/pushear lo pendiente en `feature/12-pagos` y luego ir a `dev`
        (recomendado si son cambios coherentes)
     2. Hacer `git stash` y luego ir a `dev` (recomendado si son cambios sueltos)
     3. Quedarse en `feature/12-pagos` para esta sesión (saltarse el reset a `dev`)

   ¿Qué prefieres? [1/2/3]
   ```

   - Si elige 1 → guiar `/build` (commit + push) y luego retomar checkout a `dev`.
   - Si elige 2 → `git stash push -u -m "init-stash-$(date +%s)"`, luego checkout a `dev`. Recordar al dev que su trabajo quedó en stash.
   - Si elige 3 → quedarse, marcar la sesión como "trabajando fuera de dev", y NO ejecutar el resto del paso 0.5 ni el 1.5. Continuar al paso 1.

   **Nunca usar `git checkout -f`, `git reset --hard`, ni `git stash drop` para "destrabar" el cambio de rama.** Es trabajo del dev, no nuestro.

3. **Multi-repo:** aplicar la misma lógica a **cada repo** listado en el `CLAUDE.md` del
   workspace. Si cualquier repo cae en el Caso C, pausar para ese repo y resolver antes
   de seguir con los demás. No dejar ningún repo en `main` o `master` al iniciar la sesión
   (excepto si el dev eligió la opción 3 explícitamente).

   ```bash
   # Ejemplo (iterar sobre los repos del workspace):
   for repo in repos/*/; do
     # Para cada repo, repetir el chequeo de los 3 casos.
     # NO usar un one-liner que asuma working tree limpio.
     :
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

### 1.7 Limpiar inconsistencias de estado en GitHub (rápido)

Sanear estados zombies en una sola query, sin recorrer todo el backlog:

```bash
source .claude/scripts/gh-isolated.sh || exit 1

# Work-items cerrados con label intermedio (in-progress o review) — debería ser raro.
gh issue list --repo "$GH_REPO" --state closed --label "in-progress" \
  --json number --jq '.[].number' | while read -r N; do
  gh issue edit "$N" --repo "$GH_REPO" --remove-label "in-progress" --remove-label "review"
done
```

No buscar más allá de esto. Si más adelante una skill detecta otra inconsistencia puntual, la arregla en el momento; no es trabajo de `/init` recorrer todo el backlog cada vez.

### 2. Revisar work-items pendientes (server-side filter, dos queries)

**Regla de oro:** nunca traer todos los issues del repo y filtrar localmente. Traemos solo los que importan ahora — los míos y los libres del lote, con sus estados de ownership. Esto se hace **server-side**:

```bash
source .claude/scripts/gh-isolated.sh || exit 1

# Query 1: work-items abiertos asignados a mí (los que tengo en marcha o pendientes).
MY_WORK=$(gh api -X GET search/issues \
  -f q="repo:$GH_REPO is:issue is:open assignee:$GITHUB_USER label:feature,refactor,fix,chore" \
  -F per_page=50 \
  --jq '[.items[] | {
    number, title, url: .html_url,
    labels: [.labels[].name],
    assignees: [.assignees[].login],
    in_progress: ([.labels[].name] | index("in-progress") != null)
  }]')

# Query 2: work-items abiertos SIN asignar (libres del lote, los puede tomar el dev).
FREE_WORK=$(gh api -X GET search/issues \
  -f q="repo:$GH_REPO is:issue is:open no:assignee label:feature,refactor,fix,chore" \
  -F per_page=50 \
  --jq '[.items[] | {
    number, title, url: .html_url,
    labels: [.labels[].name]
  }]')

# Query 3 (opcional, solo si el dev pregunta o hay drift sospechoso): work-items
# abiertos asignados a OTROS devs con in-progress (visibilidad multi-dev).
# Por defecto NO se muestran en /init para no abrumar.
```

Partir `MY_WORK` en tres grupos:
- `in_progress: true` → "Work-items en progreso (tuyos)".
- `in_progress: false`, asignado a mí → "Work-items asignados sin empezar (tuyos)".

`FREE_WORK` → "Work-items libres del lote (puedes tomar)".

**Si todo vacío** → mensaje corto: "No hay work-items asignados ni libres. ¿Planificar algo nuevo? → `/plan`".

**Tasks (sub-issues): solo las de los work-items en progreso.** No de los planeados ni de los cerrados — eso gasta tokens y no aporta nada al arranque:

```bash
# Por cada work-item en progreso (debería ser 1-3 normalmente, no decenas):
for PARENT_N in <lista-de-in_progress>; do
  gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        subIssues(first: 50) {
          nodes { number title state labels(first:10){ nodes{ name } } }
        }
      }
    }
  }' -f owner="$REPO_OWNER" -f repo="$REPO_NAME" -F number="$PARENT_N" \
    --jq '[.data.repository.issue.subIssues.nodes[] | select(.state == "OPEN")]'
done
```

**Solo se cargan las tasks `OPEN`.** Las cerradas no se leen — su trabajo ya está commiteado y citarlas por número alcanza.

### 3. Revisar PRs abiertos míos (una query)

```bash
source .claude/scripts/gh-isolated.sh || exit 1
gh pr list --repo "$GH_REPO" --author "$GITHUB_USER" --state open \
  --json number,title,url,isDraft,headRefName
```

### 4. Si se pasa un número de issue

```bash
gh issue view <N> --json title,body,comments,assignees,labels,url
```

### 5. Presentar estado y preguntar al dev qué hacer

Mostrar un resumen claro, agrupado por work-item, **con visibilidad del lote completo y ownership**:

```
=== Estado actual ===
Rama: dev (al día con origin)

Work-items en progreso (tuyos):
  [FEATURE] #12 — Sistema de pagos con Stripe (feature/12-sistema-pagos-stripe)
    └─ ⏳ #42 — feat: Webhook handler (in-progress)
    └─ □  #43 — feat: Endpoint /payments/intent
    └─ □  #44 — refactor: Extraer cálculo de impuestos

Work-items asignados sin empezar (tuyos):
  [FIX] #20 — Race condition en webhook

Work-items libres del lote (puedes tomar):
  [FEATURE] #25 — Notificaciones push
  [FIX] #18 — Logout no cierra sesión

PRs abiertos:
  #80 — feat: Sistema de pagos (work-item #12) [draft]
```

Luego preguntar explícitamente:

```
¿Qué quieres hacer?
  1. Continuar con un work-item en progreso
  2. Empezar un work-item ya asignado a ti (sin arrancar)
  3. Tomar un work-item libre del lote
  4. Planificar algo nuevo → /plan
  5. Otra cosa
```

Esperar respuesta del dev. **No asumir.**

### 6. Orientación según la elección

- **Opción 1:** mostrar el work-item, su task activa, verificar que la rama existe y está al día. Indicar el próximo paso concreto (`/apply`).
- **Opción 2:** confirmar arrancar el work-item. Delegar a `/apply` (que hará chequeo de ownership, asignación, label `in-progress` y creación de rama desde `dev`).
- **Opción 3 (tomar libre):** confirmar al dev. Delegar a `/apply` con el `#N` del work-item libre — `/apply` se asigna el work-item, marca `in-progress` y crea la rama. Tras esto, otros devs verán el work-item como "tomado" y no lo ofrecerán.
- **Opción 4:** invocar `/plan` directamente.
- **Opción 5:** escuchar al dev — pero **no editar código sin work-item**. Si pide tocar archivos sin que haya un work-item activo y tasks abiertas, redirigir a `/plan` (regla `no-edit-without-plan`).

### 6.5. Guardrail no-edit-without-plan (mid-chat)

Si en cualquier momento de la sesión, **después de `/init`**, el dev pide modificar código (ej: "agrega un endpoint para X", "arregla el bug de Y") **y no hay un work-item asignado al dev en `in-progress` con tasks abiertas** que cubra ese trabajo:

```
⛔ No puedo modificar código sin un work-item planificado.

Lo que pediste no tiene una task en GitHub que lo respalde. Editar `dev` o
una rama de feature sin plan de respaldo está prohibido por el flujo del
workspace.

Opciones:
  1. Planificar primero  → /plan (recomendado, conversacional)
  2. Si es un fix urgente → /plan modo express (un work-item con una sola task,
     queda registrado igual)
  3. Cancelar
```

**Excepciones que NO disparan el guardrail:**
- Hotfix explícito autorizado por el dev (queda como work-item `fix` o `hotfix` igual, pero la rama puede arrancar antes — ver `/apply` excepciones).
- Trabajo de auditoría/lectura (`/audit`, `/pentest`, `/review`) — no escriben código de producción.
- Edición de archivos de configuración del propio workspace (`.claude/`, `CLAUDE.local.md`).

## Output esperado

```
=== Sesión iniciada ===
Rama: dev (al día con origin)

Work-items en progreso (tuyos):
  [FEATURE] #12 — Sistema de pagos con Stripe
    └─ task activa: #42 — feat: Webhook handler

Work-items asignados sin empezar (tuyos):
  [FIX] #20 — Race condition en webhook

Work-items libres del lote (puedes tomar):
  [FEATURE] #25 — Notificaciones push

¿Qué quieres hacer?
  1. Continuar con [FEATURE] #12 — task #42
  2. Empezar [FIX] #20
  3. Tomar [FEATURE] #25
  4. Planificar algo nuevo → /plan
  5. Otra cosa
```

## Siguiente paso

Según la elección del dev:

- **Continuar work-item en progreso** → `/apply` en la rama existente con la task activa
- **Empezar work-item asignado / Tomar work-item libre** → `/apply` (asigna, marca `in-progress`, crea la rama desde `dev`)
- **Planificar algo nuevo** → `/plan`
- **Otros devs hicieron cambios recientes** → `/sync` primero, luego volver aquí
- **Hay un PR abierto esperando review** → `/review`
- **No existe rama `dev` en el repo** → `/branches` para normalizar antes de continuar

## Notas

- Si no hay work-items asignados ni libres, sugerir revisar el backlog del GitHub Project o invocar `/plan`.
- Nunca asumir contexto de sesiones anteriores — siempre leer desde GitHub.
- **Base por defecto: `dev`.** Cualquier trabajo en `main` requiere confirmación explícita y no persiste entre sesiones.
- Los **work-items** agrupan trabajo coherente (feature, refactor, fix, chore). Las **tasks** son las piezas concretas dentro de un work-item. No hay tasks sin work-item padre.
- **Regla `no-edit-without-plan` (paso 6.5):** mid-chat, si el dev pide editar código sin work-item de respaldo, redirigir a `/plan`. No improvisar ediciones en `dev` ni en rama de feature sin task que lo cubra.
- **Visibilidad multi-dev:** el lote del plan puede tener piezas tomadas por otros. `/init` lista propios + libres. Para tomar uno libre, `/apply` se encarga de marcarlo "tomado" para que el resto del equipo lo vea.
