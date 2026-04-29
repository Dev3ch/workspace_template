---
name: apply
description: Implementa la task activa del work-item en la rama del work-item. Usar después de /plan.
---

# /apply

Ejecuta la task activa: lee su plan, implementa el código, corre los tests y reporta resultado. Trabaja sobre la rama del work-item padre.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

Después de `/plan`, cuando hay un work-item con tasks listas para implementar. Es el comando que convierte el plan en código real.

## Estrategia de contexto mínimo

`/apply` puede consumir muchos tokens si lee archivos innecesarios. Seguir este orden de carga **bajo demanda**:

1. **Primero solo leer:** body del work-item padre + body de las **tasks abiertas únicamente** + `CLAUDE.md` (~3-6k tokens). **NO leer las tasks ya cerradas** — su trabajo ya está en el código y en el commit. Leerlas solo gasta tokens.
2. **Si la task menciona archivos específicos:** leer solo esos archivos
3. **Si hace falta más contexto:** usar `grep` para buscar símbolos específicos, NO leer directorios completos
4. **Evitar:** `Read` de archivos sin tocar, `ls -R` de proyectos grandes, leer `node_modules`, `vendor`, `dist`
5. **Si el repo es desconocido:** pedir al dev que señale los archivos clave en lugar de explorar

Reglas:
- **Antes de cada Read, preguntarse:** ¿este archivo es necesario para el cambio específico que voy a hacer?
- **Tasks cerradas = no leer.** Si el work-item tiene 10 tasks y 3 están cerradas, solo cargo el body del padre + las 7 abiertas. El historial de las cerradas vive en `git log`, no en mi contexto.

## Pasos

### 1. Identificar el work-item activo y la task a trabajar

```bash
# Work-item en progreso asignado a mí (puede ser feature, refactor, fix o chore)
gh issue list --assignee @me --state open --label "in-progress" \
  --json number,title,body,labels,url \
  --jq '.[] | select(.labels[] | .name | IN("feature","refactor","fix","chore"))'
```

Guardar el número como `PARENT_N` y su tipo (`feature`, `refactor`, `fix`, `chore`) como `PARENT_TYPE`. Listar **solo las tasks abiertas** (las cerradas no se leen):

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      subIssues(first: 50) {
        nodes { number title state url labels(first:10){ nodes{ name } } }
      }
    }
  }
}' -f owner="<owner>" -f repo="<repo>" -F number=$PARENT_N \
  --jq '[.data.repository.issue.subIssues.nodes[] | select(.state == "OPEN")]'
```

La task activa es la primera abierta con label `in-progress`. Si ninguna tiene ese label, tomar la primera abierta en orden.

**Cargar el body** únicamente del work-item padre y de las tasks abiertas. Las tasks cerradas se citan por número (referencia) pero no se leen — su trabajo ya está commiteado.

Si no hay work-item en progreso → preguntar al dev qué work-item trabajar, o invocar `/plan`.

### 2. Leer el plan de la task

Extraer del body de la task:
- **Subtareas pendientes** (checkboxes)
- **Criterios de aceptación**
- **Tipo de cambio** (feat, fix, refactor, test, docs, chore, perf)
- **Notas técnicas** (archivos, endpoints, modelos)
- **Work-item padre** (referencia para contexto)

Leer también el body del work-item padre para tener el contexto general.

Si la task no tiene plan estructurado, pedirlo al dev antes de continuar.

### 3. Verificar rama de trabajo

```bash
git status
git branch --show-current
git log --oneline -5
```

**Regla invariante:** el trabajo se hace en la rama del work-item `<tipo>/<N>-<slug>`, **creada desde `dev`**. Cada task se commitea en esa misma rama (no hay rama por task). Al cerrar el work-item completo, se abre **un solo PR** hacia `dev`.

Si la rama actual no es la del work-item:

```bash
git fetch origin --prune

WORK_BRANCH="${PARENT_TYPE}/${PARENT_N}-<slug>"
if git ls-remote --heads origin "$WORK_BRANCH" | grep -q "$WORK_BRANCH"; then
  git checkout "$WORK_BRANCH"
  git pull --ff-only origin "$WORK_BRANCH"
else
  git checkout dev && git pull --ff-only origin dev
  git checkout -b "$WORK_BRANCH"
  git push -u origin "$WORK_BRANCH"
fi
```

Si `dev` no existe en el remote → **abortar `/apply`** e invocar `/branches` primero.

**Chequeo de drift contra `dev`:**

Antes de empezar a tocar código, verificar si la rama del work-item está atrás de `origin/dev`:

```bash
git fetch origin dev --quiet
BEHIND=$(git rev-list --count "$WORK_BRANCH..origin/dev" 2>/dev/null || echo 0)
```

Si `BEHIND > 0`, avisar y ofrecer sincronizar **antes** de codear:

```
Rama actual: feature/12-sistema-pagos (3 commits atrás de origin/dev)

⚠  La rama está desactualizada. Trabajar sin sincronizar puede causar conflictos.

¿Sincronizar con dev antes de continuar?
  1. Sí, hacer rebase (recomendado — historia limpia)
  2. Sí, hacer merge (si compartes la rama con otro dev)
  3. No, continuar sin sincronizar
```

Si elige rebase: `git rebase origin/dev` + `git push --force-with-lease`. Si hay conflictos, pausar y pedir al dev que resuelva.

Si elige merge: `git merge origin/dev` + `git push`.

Si el dev ya hizo este chequeo en esta sesión hace menos de 10 minutos (`_DRIFT_LAST_CHECK_AT`), saltar este paso silenciosamente. Tras un chequeo, actualizar el timestamp.

**Excepciones:**
- **Hotfix urgente** → rama `hotfix/<N>-<slug>` desde `main`. Confirmar con el dev.
- **Task suelta sin work-item padre** → preguntar al dev si crear un work-item que la agrupe (incluso con una sola task). El patrón se mantiene uniforme.

### 4. Leer SOLO el contexto necesario

**Sí leer:**
- Archivos que el plan menciona explícitamente modificar
- Tests existentes del módulo que vas a tocar (si existen)
- La interfaz/tipo exacto que vas a usar (buscar por nombre, no leer el archivo completo)

**No leer:**
- Directorios completos sin motivo
- Archivos de dependencias (`node_modules/`, `vendor/`, `.venv/`)
- Builds o artefactos (`dist/`, `build/`, `__pycache__/`)
- Archivos de configuración que no vas a modificar

```bash
grep -rn "<NombreClaseOFuncion>" --include="*.ts" --include="*.py" --include="*.go" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .
```

Si después de esto aún no tienes claridad: **pregúntale al dev qué archivo tocar**, no explores más.

### 5. Implementar

Ejecutar las subtareas de la task en orden:
- Una subtarea a la vez
- Verificar que el código nuevo no rompe importaciones existentes
- Seguir las convenciones del stack (ver `.claude/rules/`)

### 6. Correr tests automáticamente

```bash
# Node / Next.js / React
npm test -- --passWithNoTests

# Python / Django
python manage.py test
# o con pytest:
uv run pytest -x -q

# Go
go test ./... -count=1

# Flutter
flutter test
```

Si los tests fallan:
- Analizar el error
- Corregir el código (no modificar los tests para que pasen)
- Volver a correr
- Si después de 3 intentos sigue fallando → llamar a `/debug`

### 7. Verificar cobertura mínima

El código nuevo debe tener al menos:
- Happy path cubierto
- Un caso de error cubierto
- Sin tests vacíos (sin asserts)

### 8. Marcar subtareas completadas en la task

Editar el body de la task para marcar las subtareas terminadas como `- [x]`. Comentar progreso:

```bash
gh issue comment $TASK_N --body "### Progreso /apply

- [x] <subtarea 1>
- [x] <subtarea 2>
- [ ] <subtarea 3> — en curso

**Tests:** ✓ pasando
**Rama:** \`$(git branch --show-current)\` (work-item)"
```

### 9. Si descubres trabajo nuevo durante la implementación

Si durante el trabajo aparece algo que NO estaba planeado (bug en una task ya cerrada, refactor adicional, detalle faltante):

- **Si forma parte de cerrar BIEN el work-item** → crear una nueva task hija del mismo work-item padre (ver sección "Agregar tasks durante el desarrollo" en `/plan`).
- **Si es un problema de algo ya mergeado en producción** → es un nuevo work-item de tipo `fix`, no parte de este. Comunicárselo al dev.

### 9.1 Si el dev necesita pausar el work-item para hacer otra cosa

Caso típico: vas por la task 5 de 10, ya commiteaste 4, y el dev pide trabajar en otra cosa urgente. **No sobreescribir la rama actual con el nuevo trabajo.** El nuevo trabajo va en otra rama, **siempre desde `dev`**.

Pasos:

1. **Asegurar que lo que ya está hecho quede guardado:** llamar a `/build` para commitear y pushear las tasks cerradas hasta el momento. Si hay cambios sin terminar (la task 5 a medio hacer), confirmar con el dev:
   - ¿Commitear como WIP en la rama actual y retomar luego? (recomendado si el cambio compila)
   - ¿Stash con nombre descriptivo? (`git stash push -u -m "wip: <task>"`)
   - ¿Descartar? (solo si el dev lo pide explícitamente)

2. **Las tasks cerradas se quedan cerradas.** Las abiertas del work-item siguen abiertas para retomar después; no hay que tocarlas. El work-item sigue `in-progress` hasta que se complete.

3. **El nuevo trabajo NO se mete en esta rama.** Volver a `dev` (`git checkout dev && git pull --ff-only`) y arrancar el nuevo work-item desde ahí, en su propia rama `<tipo>/<N>-<slug>`.

4. **Nunca abrir el PR con el work-item a medias.** El PR se abre cuando todas las tasks del work-item están cerradas (ver `/build`). Si el dev presiona por hacer el PR ahora con lo que hay, recomendar mover las tasks pendientes a un work-item de seguimiento (`<tipo>: <título original> — fase 2`) y dejar este work-item con solo lo cubierto.

### 10. Preparar para /build

Verificar que todo está listo para commitear:
```bash
git diff --stat
git status
```

**Importante:** `/apply` no hace commit ni push. Eso lo hace `/build`, y siempre con confirmación del dev. El commit corresponde a la task completa, con mensaje formato Conventional Commits:

```
<tipo>(<scope>): descripción de la task (#<TASK_N>) — <tipo-padre> #<PARENT_N>
```

Donde `<tipo>` es el tipo de la task (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`).

## Output esperado

```
=== /apply completado ===
Work-item: [FEATURE] #12 — Sistema de pagos con Stripe
Task:      #42 — feat: Webhook handler

Implementado:
  ✓ apps/payments/views.py — PaymentWebhookView
  ✓ apps/payments/serializers.py — PaymentIntentSerializer
  ✓ tests/payments/test_webhook.py — 4 tests nuevos

Tests: ✓ 47 passed, 0 failed
Cobertura nueva: 89%

Tasks restantes en el work-item:
  □ #43 — feat:     Endpoint /payments/intent
  □ #44 — refactor: Extraer cálculo de impuestos

Listo para: /build (commit de la task #42, sin cerrar el work-item todavía)
```

## Siguiente paso

- **Task terminada, quedan más en el work-item** → `/build` (commit de la task, NO abrir PR aún)
- **Última task del work-item** → `/build` (commit + ofrecer abrir PR del work-item completo)
- **Tests fallan después de 3 intentos** → `/debug` con el error específico
- **Detectas que otro issue ya resolvió parte** → `/sync` para reconciliar
- **La task resultó más grande de lo planeado** → `/plan` para dividirla en más tasks

## Notas

- No hacer commit dentro de `/apply` — ese es trabajo de `/build`, siempre con confirmación.
- Trabajar **una task a la vez**. No mezclar cambios de varias tasks en el mismo trabajo.
- Si una task es muy grande, sugerir dividirla en más tasks con `/plan`.
- Si se detecta que otra task ya resolvió parte → llamar a `/sync` antes de continuar.
- Nunca modificar tests existentes para que pasen — solo el código de producción.
- **Costo:** este skill puede consumir muchos tokens. Priorizar Edit sobre Write, grep sobre Read de archivos completos, y pedir contexto al dev antes de explorar.
