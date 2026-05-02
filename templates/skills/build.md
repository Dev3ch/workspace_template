---
name: build
description: Commit + push de UNA task. Cierra la task en GitHub. Al cerrar la última task del work-item, pregunta PR/más tasks/dejar y luego ofrece pasar al siguiente work-item del lote.
---

# /build

Guarda el progreso de la sesión en GitHub. **Una invocación de `/build` cierra exactamente UNA task** con su commit, su push y su cierre en GitHub. Cuando esa fue la última task del work-item, ofrece tres caminos: abrir el PR, agregar más tasks al work-item, o dejarlo así. Tras el PR, ofrece pasar al siguiente work-item del lote (con chequeo de ownership).

**Regla dura — una invocación de `/build` = una task = un commit.** Si el diff actual abarca cambios de varias tasks, se detecta en el paso 1 y se obliga a partir.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

Después de `/apply`, cuando una task está terminada y los tests pasan. También al cerrar sesión si quedan cambios sin commitear.

## Pasos

### 1. Revisar cambios + guardrail "diff multi-task"

```bash
git status
git diff --stat
```

**Detectar diff multi-task.** Recolectar las tasks abiertas del work-item activo y las pistas que cada una declara (archivos en "Notas técnicas" del body, scope esperado del Conventional Commit, etc.). Si el diff toca archivos atribuibles a **más de una** task abierta, **bloquear** y pedir partir el commit:

```
⚠ El diff actual cubre cambios de varias tasks abiertas:

  Task #42 (feat: Webhook handler):
    M apps/payments/webhook.py
    A tests/payments/test_webhook.py

  Task #43 (feat: Endpoint /payments/intent):
    M apps/payments/views.py
    M apps/payments/urls.py

`/build` cierra UNA task por invocación. Necesito partir esto.

Opciones:
  1. Commitear solo los archivos de #42 ahora (recomendado si #42 ya está terminada).
     Los archivos de #43 quedan sin commitear hasta el próximo /apply + /build.
  2. Cancelar y revisar manualmente con `git add -p` antes de volver.
```

Si el dev elige 1 → `git add` selectivo solo de los archivos atribuibles a la task activa. Confirmar con `git diff --cached --stat` antes de commitear.

Si el dev elige 2 → salir sin tocar nada.

**Heurística de atribución:** scope del nombre de la task, "Notas técnicas" de su body, prefijo de path. Si la atribución es ambigua, preguntar al dev en qué task pertenece cada archivo en duda.

### 2. Confirmar commit con el dev (SIEMPRE, sin excepciones)

**Nunca commitear sin preguntar.** Esto aplica a **cada** commit, sin excepciones:
- Aunque sea el segundo, tercero o décimo commit de la sesión: preguntar.
- Aunque la sesión anterior haya autorizado commits: preguntar de nuevo.
- Aunque el dev haya dicho "vamos rápido": preguntar.

La autorización es por commit, no por sesión. Mostrar al dev el resumen de cambios y preguntar:

```
Cambios listos para commit (atribuidos a la task #42):
  M apps/payments/views.py
  M apps/payments/serializers.py
  A tests/payments/test_webhook.py

Work-item activo:  [FEATURE] #12 — Sistema de pagos con Stripe
Task activa:       #42 — feat: Webhook handler
Tipo de commit:    feat (Conventional Commits)
Mensaje propuesto: "feat(payments): webhook handler de Stripe (#42) — feature #12"

¿Hacemos commit? [S/n]
```

Si confirma:

```bash
git add <archivos-relevantes>
git commit -m "<tipo>(<scope>): descripción de la task (#<TASK_N>) — <tipo-padre> #<PARENT_N>"
```

**Reglas del mensaje (Conventional Commits):**
- `<tipo>` = tipo de la task (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`).
- `<scope>` = módulo afectado (ej: `payments`, `auth`, `api`).
- `<tipo-padre>` = tipo del work-item (`feature`, `refactor`, `fix`, `chore`).

**Un commit = una task cerrada.** Si en una sesión cerraron dos tasks, son dos invocaciones de `/build` con sus dos commits separados, cada uno con su confirmación.

### 3. Confirmar push con el dev

**Chequeo silencioso de drift antes del push:** si han pasado más de 10 minutos desde el último chequeo (`_DRIFT_LAST_CHECK_AT`), hacer `git fetch origin dev --quiet` y comparar. Si la rama está atrás, mencionarlo en el prompt:

```
¿Pusheamos a origin/feature/12-sistema-pagos-stripe? [S/n]

  ℹ  Heads-up: dev avanzó 2 commits desde tu último chequeo.
     Cuando termines la última task del work-item, te avisaré para sincronizar
     antes del PR.
```

Si está al día, prompt simple:

```
¿Pusheamos a origin/feature/12-sistema-pagos-stripe? [S/n]
```

Si confirma:

```bash
git push origin <work-branch>
```

Si la rama no tiene upstream:
```bash
git push -u origin <work-branch>
```

### 4. Cerrar la task y registrar el commit

```bash
COMMIT_SHA=$(git rev-parse HEAD)
gh issue comment $TASK_N --body "Implementado en \`$COMMIT_SHA\`. Closes #$TASK_N."
gh issue close $TASK_N
gh issue edit $TASK_N --remove-label "in-progress"
```

Marcar el checkbox correspondiente en el body del work-item padre.

### 5. ¿Quedan más tasks en el work-item?

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      subIssues(first: 50) { nodes { number title state } }
    }
  }
}' -f owner="$REPO_OWNER" -f repo="$REPO_NAME" -F number=$PARENT_N
```

**Si quedan tasks abiertas** → preguntar:

```
✓ Task #42 cerrada (commit a1b2c3d, pusheada).

Tasks restantes en el work-item #12:
  □ #43 — feat:     Endpoint /payments/intent
  □ #44 — refactor: Extraer cálculo de impuestos

¿Continuamos con la siguiente task?
  1. Sí, /apply de #43 (la marca in-progress y arranca)
  2. No, paro aquí
```

Si elige 1 → marcar #43 con `in-progress` y delegar a `/apply`. Si elige 2 → terminar la invocación.

**No abrir PR todavía.** El work-item sigue en progreso.

**Si todas las tasks están cerradas (work-item completo) → pasar al paso 6.**

### 6. Última task cerrada — preguntar qué hacer con el work-item

**No abrir el PR automáticamente.** El dev puede querer agregar más tasks antes de cerrar el work-item, o dejarlo abierto sin PR por algún motivo. Preguntar:

```
✓ Última task del work-item #12 cerrada.

¿Qué hacemos con el work-item?
  1. Abrir el PR ahora (default — flujo estándar)
  2. Agregar más tasks al work-item antes de cerrar  → /plan en modo "agregar a #12"
  3. Dejar el work-item sin PR aún (lo retomo después)
```

- Si elige 1 → seguir al paso 6.5 (chequeo de drift + apertura del PR).
- Si elige 2 → invocar `/plan` en modo "agregar a `#12`" para crear nuevas tasks hijas. Tras crear, volver al ciclo `/apply` → `/build`.
- Si elige 3 → terminar la invocación. El work-item queda sin PR; el próximo `/init` lo seguirá listando como en progreso.

### 6.5. Chequeo crítico de drift contra dev y apertura del PR

**Antes de abrir el PR: chequeo crítico de drift contra dev.**

```bash
git fetch origin dev --quiet
BEHIND=$(git rev-list --count "$WORK_BRANCH..origin/dev" 2>/dev/null || echo 0)
```

Si `BEHIND > 0`, **bloquear la apertura del PR** y avisar:

```
⚠ Antes de abrir el PR: la rama está 7 commits atrás de dev.
  Si abres el PR sin sincronizar, GitHub mostrará conflictos o el reviewer
  verá un diff sucio con cambios que no son tuyos.

¿Sincronizar con dev primero?
  1. Sí, rebase (recomendado)
  2. Sí, merge (si compartes la rama con otro dev)
  3. No, abrir el PR igualmente (riesgo: conflictos en GitHub)
```

Si elige rebase/merge, sincronizar y luego mostrar la confirmación de apertura del PR.

Si la rama está al día con dev (`BEHIND == 0`), saltar al prompt directo:

```
¿Abrimos el PR del work-item #12 hacia dev? [S/n]
  Rama: feature/12-sistema-pagos-stripe → dev (al día con origin)
  Tasks incluidas: #42, #43, #44
```

Si confirma:

```bash
# Determinar el tipo de commit del PR según el tipo del work-item
PR_TYPE="feat"   # feature → feat, fix → fix, refactor → refactor, chore → chore

gh pr create --base dev --head "$WORK_BRANCH" \
  --title "${PR_TYPE}(<scope>): Sistema de pagos con Stripe (feature #${PARENT_N})" \
  --body "$(cat <<EOF
Closes #${PARENT_N}

## Tasks incluidas
- Closes #42 — feat: Webhook handler
- Closes #43 — feat: Endpoint /payments/intent
- Closes #44 — refactor: Extraer cálculo de impuestos

## Resumen
- <1-3 bullets del cambio global del work-item>

## Test plan
- [ ] <qué probar para validar el work-item completo>
EOF
)"
```

Marcar el work-item con label `review` y quitar `in-progress`:

```bash
gh issue edit $PARENT_N --add-label "review" --remove-label "in-progress"
```

**Multi-repo:** si el work-item afecta varios repos, abrir un PR por repo (nunca consolidar repos distintos en un solo PR). Cada PR cierra las tasks que le corresponden a ese repo.

### 6.6. Elegir el camino de review/merge

Una vez abierto el PR, preguntar al dev cómo quiere cerrar el ciclo. **Esta decisión es del dev, no de Claude** — nunca mergear automáticamente sin que el dev lo pida.

```
PR #19 abierto → https://github.com/<owner>/<repo>/pull/19

¿Cómo quieres cerrar este PR?

  1. Dejar para review del equipo  (default — workflow estándar)
       Otra persona del equipo revisa, comenta y mergea cuando esté listo.
       Yo no toco el PR. Tu trabajo aquí terminó.

  2. Mergear yo mismo ahora
       Si eres solo-dev, lo hago con squash merge a dev y cierro todo.
       (Equivale a `gh pr merge --squash --delete-branch`).

  3. Auto-merge cuando pasen los checks
       Lo dejo en cola: GitHub mergea cuando CI termine en verde.
       (Equivale a `gh pr merge --auto --squash`).

  4. Asignarlo a alguien específico para que lo revise
       Le pongo reviewer y lo dejo abierto.
```

Implementación según la opción:

```bash
case "$CHOICE" in
  1)
    # Sin acción extra: el PR queda abierto con label "review".
    echo "PR queda en review. Cuando el equipo mergee, /build paso 8 cerrará el work-item."
    ;;
  2)
    gh pr merge "$PR_NUMBER" --squash --delete-branch
    # Inmediatamente saltar al paso 8 (cierre automático tras merge).
    ;;
  3)
    gh pr merge "$PR_NUMBER" --auto --squash --delete-branch || {
      echo "⚠  Auto-merge no está habilitado en este repo."
      echo "   Activa Settings → General → 'Allow auto-merge' o usa la opción 1."
    }
    ;;
  4)
    read -p "Usuario o equipo a asignar como reviewer (ej: @octocat o org/team): " REVIEWER
    gh pr edit "$PR_NUMBER" --add-reviewer "$REVIEWER"
    ;;
esac
```

**Reglas:**
- **Default = opción 1 (dejar para review humano).** No es deuda técnica esperar review — es el workflow correcto en equipos.
- **Opción 2 (self-merge) solo tiene sentido para solo-devs** o repos donde el dev tiene permisos de merge directo. Si la rama protegida `dev` requiere review, esto fallará y se reporta el error sin reintentos creativos.
- **Opción 3 (auto-merge) requiere "Allow auto-merge" habilitado** en Settings del repo. Si no está, sugerir habilitarlo y caer a opción 1 o 4.
- **Nunca mergear sin que el dev pida explícitamente la opción 2 o 3.** Si el dev solo dijo "abre el PR", el default es **dejarlo abierto**.

### 7. Comentar progreso global del work-item

Comentar el work-item con un resumen de la sesión:

```bash
gh issue comment $PARENT_N --body "$(cat <<EOF
## Progreso sesión $(date +%Y-%m-%d)

**Tasks cerradas en esta sesión:**
- #42 — feat: Webhook handler
- #43 — feat: Endpoint /payments/intent

**Pendientes:**
- #44 — refactor: Extraer cálculo de impuestos

**Estado:** [En progreso | PR abierto en review | Cerrado]
EOF
)"
```

### 8. Tras el merge del PR: cierre automático + ofrecer siguiente work-item del lote

Cuando el PR se mergea (en GitHub, después de la review), **es responsabilidad de `/build` dejar el board limpio en automático, sin pedir confirmaciones extra**. No decir "voy a cerrar manualmente" ni dejar issues en `in-progress` si el work-item quedó completo.

Detectar si el PR del work-item ya fue mergeado:

```bash
PR_STATE=$(gh pr view "$PR_NUMBER" --json state,merged --jq '.state + ":" + (.merged|tostring)')
# "MERGED:true" → mergeado
# "OPEN:false"  → todavía abierto
# "CLOSED:false" → cerrado sin merge
```

Si está mergeado:

```bash
# 1. Cerrar el work-item padre
gh issue close "$PARENT_N" --comment "Mergeado en PR #$PR_NUMBER"

# 2. Quitar labels de estado intermedio del padre
gh issue edit "$PARENT_N" --remove-label "in-progress" --remove-label "review"

# 3. Verificar que NINGUNA task quede abierta o con label in-progress
OPEN_TASKS=$(gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      subIssues(first: 50) { nodes { number state labels(first:10){ nodes{ name } } } }
    }
  }
}' -f owner="$REPO_OWNER" -f repo="$REPO_NAME" -F number="$PARENT_N" \
  --jq '[.data.repository.issue.subIssues.nodes[] | select(.state == "OPEN")]')

if [ "$(echo "$OPEN_TASKS" | jq 'length')" -gt 0 ]; then
  echo "$OPEN_TASKS" | jq -r '.[] | .number' | while read -r N; do
    gh issue close "$N" --comment "Cerrado al mergear PR #$PR_NUMBER (work-item #$PARENT_N)"
    gh issue edit "$N" --remove-label "in-progress"
  done
fi

# 4. Limpiar la rama del work-item (con confirmación)
git checkout dev && git pull --ff-only origin dev
echo "¿Borrar la rama local y remota '$WORK_BRANCH'? [S/n]"
# Si confirma:
#   git branch -d "$WORK_BRANCH"
#   git push origin --delete "$WORK_BRANCH"
```

**Después de la limpieza, ofrecer el siguiente work-item del lote** (con chequeo de ownership):

```bash
# Listar work-items abiertos asignados a mí (incluye los del mismo lote y otros)
OPEN_WORK=$(gh api -X GET search/issues \
  -f q="repo:$GH_REPO is:issue is:open assignee:$GITHUB_USER" \
  -F per_page=20 \
  --jq '[.items[] | select((.labels[].name) as $l | ["feature","refactor","fix","chore"] | any(. == $l)) | {number, title, labels: [.labels[].name]}]')

# Listar también work-items abiertos sin asignar (libres para tomar)
FREE_WORK=$(gh api -X GET search/issues \
  -f q="repo:$GH_REPO is:issue is:open no:assignee" \
  -F per_page=20 \
  --jq '[.items[] | select((.labels[].name) as $l | ["feature","refactor","fix","chore"] | any(. == $l)) | {number, title, labels: [.labels[].name]}]')
```

Mostrar al dev:

```
✓ Work-item #12 cerrado y limpio.

Otros work-items abiertos:

  Asignados a ti (sin empezar):
    [FIX] #18 — Logout no cierra sesión

  Libres para tomar:
    [FEATURE] #25 — Notificaciones push

  Tomados por otros (NO los toques):
    [REFACTOR] #15 — Migración de auth (en @otro-dev, in-progress)

¿Tomamos otro?
  1. Continuar con [FIX] #18  → /apply
  2. Tomar [FEATURE] #25 (queda asignado a ti)  → /apply
  3. No, terminar sesión
```

Si elige tomar uno → asignárselo y delegar a `/apply` (que pasará por su chequeo de ownership y creará la rama). Si elige terminar → cerrar la invocación.

**Reglas:**
- Cierre del work-item padre y de tasks colgantes: **automático, sin preguntar.** El merge ya fue la decisión.
- Borrado de rama local/remota: **sí se pregunta** — destructivo y no revertible sin trabajo.
- **Nada queda en `in-progress` si el work-item ya está cerrado.** Si Claude detecta esa inconsistencia en una próxima `/init`, debe limpiar.
- **Nunca tomar work-items asignados a otros devs.** Filtrar y solo ofrecer libres o propios.

## Siguiente paso

- **Task cerrada, quedan más en el work-item** → `/apply` con la siguiente task
- **Última task cerrada y eligió "agregar más tasks"** → `/plan` en modo agregar
- **Última task cerrada y eligió "abrir PR"** → flujo PR (paso 6.5/6.6) → `/review`
- **PR mergeado y queda otro work-item del lote** → `/apply` sobre el siguiente
- **Trabajo afecta otros repos** → `/cross` para coordinar

## Notas

- **Una invocación de `/build` cierra exactamente UNA task en GitHub.** Si quedan archivos en el working tree que pertenecen a otra task, son para el próximo `/build`. El paso 1 detecta diff multi-task y bloquea.
- **Confirmación obligatoria** antes de cada commit, push y apertura de PR. Nunca asumir.
- **Un commit = una task.** No agrupar varias tasks en un commit.
- **El PR se abre solo cuando todas las tasks están cerradas Y el dev confirma** "abrir PR ahora" en el paso 6.
- **Conventional Commits siempre.** El tipo del commit refleja la task, no el work-item padre.
- **Tras el merge, ofrecer el siguiente work-item con chequeo de ownership** — nunca tomar uno que ya tiene a otro dev asignado con `in-progress`.
- Si el trabajo está en varios repos, hacer push en todos los que correspondan.
- Nunca guardar progreso en archivos locales fuera del repo.
