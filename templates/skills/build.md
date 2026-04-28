---
name: build
description: Commit + push de la task. Comenta progreso. Al cerrar la última task del work-item, ofrece abrir el PR único.
---

# /build

Guarda el progreso de la sesión en GitHub. Hace commit por task cerrada y push al remote. Cuando todas las tasks del work-item están cerradas, ofrece abrir el PR único hacia `dev`.

## Credenciales de GitHub

```bash
source .claude/scripts/resolve-gh-creds.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

Después de `/apply`, cuando una task está terminada y los tests pasan. También al cerrar sesión si quedan cambios sin commitear.

## Pasos

### 1. Revisar cambios actuales

```bash
git status
git diff --stat
```

### 2. Confirmar commit con el dev

**Nunca commitear sin preguntar.** Mostrar al dev el resumen de cambios y preguntar:

```
Cambios listos para commit:
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

**Un commit = una task cerrada.** Si en una sesión cerraron dos tasks, son dos commits separados.

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
      subIssues(first: 50) {
        nodes { number title state }
      }
    }
  }
}' -f owner="<owner>" -f repo="<repo>" -F number=$PARENT_N
```

**Si quedan tasks abiertas:**
- No abrir PR todavía. El work-item sigue en progreso.
- Preguntar al dev: "¿Continuamos con la siguiente task #N?"
- Si confirma, marcar la siguiente task con label `in-progress` y volver a `/apply`.

**Si todas las tasks están cerradas (work-item completo):**
- Pasar al paso 6.

### 6. Cerrar el work-item y abrir el PR (con confirmación)

**Antes de abrir el PR: chequeo crítico de drift contra dev.**

```bash
git fetch origin dev --quiet
BEHIND=$(git rev-list --count "$WORK_BRANCH..origin/dev" 2>/dev/null || echo 0)
```

Si `BEHIND > 0`, **bloquear la apertura del PR** y avisar:

```
Todas las tasks del work-item #12 están cerradas.

⚠  Antes de abrir el PR: la rama está 7 commits atrás de dev.
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
Todas las tasks del work-item #12 están cerradas.

¿Abrimos el PR del work-item completo hacia dev? [S/n]
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

### 7. Actualizar el work-item con el progreso global

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

## Siguiente paso

- **Task cerrada, quedan más en el work-item** → `/apply` con la siguiente task
- **Work-item completo, PR abierto** → `/review`
- **Work-item completo y va a main/staging** → `/review` → `/secure` → `/deploy`
- **Trabajo afecta otros repos** → `/cross` para coordinar

## Notas

- **Confirmación obligatoria** antes de cada commit, push y apertura de PR. Nunca asumir.
- **Un commit = una task.** No agrupar varias tasks en un commit.
- **El PR se abre solo cuando todas las tasks están cerradas** y el dev confirma.
- **Conventional Commits siempre.** El tipo del commit refleja la task, no el work-item padre.
- Si el trabajo está en varios repos, hacer push en todos los que correspondan.
- Nunca guardar progreso en archivos locales fuera del repo.
