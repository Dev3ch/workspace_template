---
name: apply
description: Implementa UNA task del work-item activo. Crea la rama del work-item desde dev si no existe. Una invocación = una task. STOP al terminar.
---

# /apply

Ejecuta **una sola task** del work-item activo: lee su plan, implementa el código, corre los tests y reporta. Trabaja sobre la rama del work-item padre (la crea desde `dev` si aún no existe).

**Regla dura — una invocación de `/apply` = una task.** Al terminar la task, `/apply` **se detiene**. No lee la siguiente task. No empieza otra. No salta a otro work-item. El dev decide cuándo invocar `/build` y luego `/apply` de nuevo. Esto es lo que mantiene el flujo interactivo y el patrón "1 task = 1 commit".

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

Después de `/plan` (si el dev eligió arrancar un work-item del lote) o desde `/init` (si el dev eligió continuar/empezar un work-item ya planificado). Es el comando que convierte el plan en código real, una task a la vez.

**Regla `no-edit-without-plan`:** si el dev pide editar código y NO hay un work-item asignado a él en `in-progress` con tasks abiertas, `/apply` **rechaza la edición** y redirige a `/plan`. Ver paso 0.5.

## Estrategia de contexto mínimo

`/apply` puede consumir muchos tokens si lee archivos innecesarios. Seguir este orden de carga **bajo demanda**:

1. **Primero solo leer:** body del work-item padre + body de **la task activa** + `CLAUDE.md` (~2-4k tokens). **NO leer las demás tasks** (ni cerradas ni abiertas que no son la activa) — la cerrada ya está en código y commits; la abierta no-activa se leerá en su propio `/apply`.
2. **Si la task menciona archivos específicos:** leer solo esos archivos.
3. **Si hace falta más contexto:** usar `grep` para buscar símbolos específicos, NO leer directorios completos.
4. **Evitar:** `Read` de archivos sin tocar, `ls -R` de proyectos grandes, leer `node_modules`, `vendor`, `dist`.
5. **Si el repo es desconocido:** pedir al dev que señale los archivos clave en lugar de explorar.

Reglas:
- **Antes de cada Read, preguntarse:** ¿este archivo es necesario para esta task específica?
- **Tasks no activas = no leer.** Solo el padre + la task activa.

## Pasos

### 0.5 Guardrail no-edit-without-plan

**Antes de tocar absolutamente nada,** verificar que existe un work-item con tasks abiertas asignado al dev actual:

```bash
source .claude/scripts/gh-isolated.sh || exit 1

ACTIVE_WORK=$(gh api -X GET search/issues \
  -f q="repo:$GH_REPO is:issue is:open assignee:$GITHUB_USER label:in-progress" \
  -F per_page=10 \
  --jq '[.items[] | select((.labels[].name) as $l | ["feature","refactor","fix","chore"] | any(. == $l))]')
```

Si `ACTIVE_WORK` está vacío **y** el dev no pasó un work-item específico para arrancar:

```
⛔ No hay work-item asignado en `in-progress`.

`/apply` no edita código sin un work-item planificado de respaldo.

Opciones:
  1. Planificar uno nuevo  → /plan
  2. Tomar un work-item asignado sin empezar (si lo hay) → /init
  3. Cancelar
```

**Solo se sale del guardrail si:**
- El dev acaba de invocar `/plan` y eligió "arrancar #N" (entonces `/apply` recibe `#N` como argumento explícito).
- El dev acaba de invocar `/init` y eligió "continuar/empezar #N".
- Hay exactamente un work-item asignado `in-progress` y se asume continuación.

### 1. Identificar el work-item activo y la task a trabajar

```bash
# Work-item en progreso asignado a mí (puede ser feature, refactor, fix o chore)
gh issue list --assignee @me --state open --label "in-progress" \
  --json number,title,body,labels,url \
  --jq '.[] | select(.labels[] | .name | IN("feature","refactor","fix","chore"))'
```

Guardar el número como `PARENT_N` y su tipo (`feature`, `refactor`, `fix`, `chore`) como `PARENT_TYPE`.

Si hay **más de un work-item `in-progress` del mismo dev** → preguntar cuál tomar (no asumir). Si hay **uno solo** → usar ese.

Listar **solo las tasks abiertas** del work-item:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      subIssues(first: 50) { nodes { number title state url labels(first:10){ nodes{ name } } } }
    }
  }
}' -f owner="$REPO_OWNER" -f repo="$REPO_NAME" -F number=$PARENT_N \
  --jq '[.data.repository.issue.subIssues.nodes[] | select(.state == "OPEN")]'
```

La **task activa** es la primera abierta con label `in-progress`. Si ninguna tiene ese label, tomar la primera abierta en orden (y marcarla `in-progress` en el paso 3.5).

**Cargar el body** únicamente del work-item padre y de la task activa. Las demás tasks (abiertas o cerradas) se citan por número pero no se leen.

### 2. Chequeo de ownership del work-item (multi-dev)

**Antes de tocar la rama,** verificar que el work-item está libre o asignado al dev actual:

```bash
ASSIGNEES=$(gh issue view "$PARENT_N" --json assignees --jq '[.assignees[].login]')
HAS_IN_PROGRESS=$(gh issue view "$PARENT_N" --json labels --jq '[.labels[].name] | any(. == "in-progress")')
```

Decidir según los casos:

- **Caso A — sin asignar, sin label `in-progress`:** está libre. Lo tomo: asignármelo + agregar label `in-progress` (paso 3.5).
- **Caso B — asignado a mí + `in-progress`:** ya es mío. Continuar.
- **Caso C — asignado a otro dev + `in-progress`:** **otra persona lo tomó**. Parar y avisar:
  ```
  ⛔ El work-item #12 está siendo trabajado por @otro-dev.
     (Asignado: @otro-dev, label `in-progress`)

  Opciones:
    1. Tomar otro work-item del lote (lista los que estén libres)
    2. Coordinar con @otro-dev y dejar este flujo
    3. Cancelar
  ```
  No modificar nada del work-item ajeno. No crear rama. No editar código.

- **Caso D — asignado pero sin `in-progress`** (raro): preguntar al dev si quiere apropiarse del work-item antes de continuar.

### 3. Leer el plan de la task activa

Extraer del body de la task:
- **Subtareas pendientes** (checkboxes)
- **Criterios de aceptación**
- **Tipo de cambio** (feat, fix, refactor, test, docs, chore, perf)
- **Notas técnicas** (archivos, endpoints, modelos)
- **Work-item padre** (referencia para contexto)

Leer también el body del work-item padre para tener el contexto general.

Si la task no tiene plan estructurado, pedirlo al dev antes de continuar.

### 3.5 Apropiarse del work-item y de la task (lock para el equipo)

Si en el paso 2 fue Caso A (libre), tomarlo ahora — esto **lockea** el work-item para el resto del equipo:

```bash
gh issue edit "$PARENT_N" --add-assignee "@me" --add-label "in-progress"
```

Si la task activa no tenía `in-progress`:

```bash
gh issue edit "$TASK_N" --add-assignee "@me" --add-label "in-progress"
```

Tras esto, cualquier `/init` de otro dev verá el work-item como tomado y no lo ofrecerá.

### 3.7 Configurar modo de push del work-item (una sola vez)

**Solo si es la primera invocación de `/apply` sobre este work-item** (el work-item no tiene aún tag `<!-- push-mode: ... -->` en sus comentarios). Si ya hay modo configurado, saltar este paso silenciosamente.

```bash
HAS_MODE=$(gh issue view "$PARENT_N" --json comments \
  --jq '[.comments[].body | scan("<!-- push-mode: (on-pr|per-task|manual) -->")] | length' \
  2>/dev/null || echo 0)
```

Si `HAS_MODE == 0`, preguntar al dev cómo quiere manejar los push de este work-item:

```
Este work-item tiene N tasks. ¿Cómo manejamos los push?

  1. on-pr     — push consolidado al final, justo antes de abrir el PR  ✓ (default)
                 Recomendado para solo-dev, work-items cortos, ramas con CI ruidoso
                 o pre-push hooks lentos. Un solo push por todo el work-item.

  2. per-task  — push después de cada commit (comportamiento clásico)
                 Recomendado si compartes la rama con otro dev o quieres backup
                 remoto continuo durante work-items largos.

  3. manual    — solo pusheo cuando me lo pidas explícitamente
                 Para devs que prefieren control total (raro).
```

El modo elegido se persiste como comentario en el work-item para que `/build` lo lea en cada commit:

```bash
gh issue comment "$PARENT_N" --body "Push mode configurado: $PUSH_MODE

<!-- push-mode: $PUSH_MODE -->

Detalle:
- on-pr     → push consolidado antes del PR
- per-task  → push después de cada /build
- manual    → push solo si lo pides

Puedes cambiarlo en cualquier momento diciéndome \"cambia el push mode a <modo>\"."
```

**Override por chat:** si en cualquier momento del work-item el dev dice "cambia el push mode a per-task" / "ya no pushees hasta el final" / etc., actualizar el tag con un nuevo comentario (gana el más reciente).

### 4. Verificar / crear rama de trabajo

```bash
git status
git branch --show-current
git log --oneline -5
```

**Regla invariante:** el trabajo se hace en la rama del work-item `<tipo>/<N>-<slug>`, **creada desde `dev`**. Cada task se commitea en esa misma rama (no hay rama por task). Al cerrar el work-item completo, se abre **un solo PR** hacia `dev`.

```bash
git fetch origin --prune

WORK_BRANCH="${PARENT_TYPE}/${PARENT_N}-<slug>"
if git ls-remote --heads origin "$WORK_BRANCH" | grep -q "$WORK_BRANCH"; then
  # La rama ya existe en remoto (tal vez porque otro dev la creó al tomar el work-item antes — pero el ownership ya lo validó el paso 2)
  git checkout "$WORK_BRANCH" 2>/dev/null || git checkout -b "$WORK_BRANCH" "origin/$WORK_BRANCH"
  git pull --ff-only origin "$WORK_BRANCH"
else
  # Primera vez que se hace /apply sobre este work-item: crear la rama desde dev y pushear.
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

### 5. Leer SOLO el contexto necesario

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

### 6. Implementar SOLO la task activa

Ejecutar las subtareas de **la task activa** en orden:
- Una subtarea a la vez
- Verificar que el código nuevo no rompe importaciones existentes
- Seguir las convenciones del stack (ver `.claude/rules/`)

**Prohibido:**
- Tocar archivos que pertenecen a otra task del work-item.
- Implementar parcialmente la siguiente task "porque ya estaba ahí".
- Refactorizar código fuera del alcance declarado en el body de la task.

Si descubres que la task se solapa con otra → parar, comentarlo en el work-item, y dejar que el dev decida (puede que toque replanificar con `/plan`).

### 7. Correr el gate de tests (one-shot, no-interactivo)

`/apply` detecta el gate apropiado según el stack del repo y lo corre **una sola vez**, sin watchers, sin browsers headed, sin prompts. Detección y comandos:

| Stack detectado | Framework del gate | Comando |
|---|---|---|
| **Django** (con pytest) | `pytest` | `uv run pytest -x -q --tb=short` (o `pytest -x -q --tb=short` sin `uv`) |
| **Django** (sin pytest) | django-test | `python manage.py test --keepdb -v 1` |
| **FastAPI** | `pytest` | `uv run pytest -x -q --tb=short` |
| **Go** | `go test` | `go test -short -count=1 ./...` |
| **Flutter** | `flutter test` | `flutter test --reporter compact` |
| **React Native** (con jest) | `jest` | `<pkg-mgr> test -- --ci --reporters=default` |
| **Frontend web** (Next/React/Vue/Nuxt) **con Playwright** | `playwright` | `<pkg-mgr> run test:e2e` |
| **Frontend web sin Playwright** | (ninguno) | Sugerencia de chore para integrarlo (no bloquea) |

**Detección del package manager (JS/TS):** orden por lockfile — `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lockb`/`bun.lock` → `bun`, fallback `npm`. Nunca asumir `npm`.

**Convenciones obligatorias del gate:**

- **One-shot.** Nunca correr en modo watch ni dev server con HMR. `--ci`, `--run`, `-x`, `--reporter=line/dot/compact`.
- **No-interactivo.** `CI=true` en el entorno, no preguntar nada al humano, no abrir browser headed (Playwright corre headless por default; nunca usar `--headed`).
- **Mocks > datos reales.** Para flujos con auth, usar MSW/handlers de mock. **No pedir credenciales reales al dev.** Si la task **requiere** auth real para validarse y no hay mock → declarar el gate como "skipped: requires manual validation" y reportarlo en el output.
- **Timeout duro por gate** (Python/Go/RN: 180s, Playwright: 240s, Flutter: 180s). Si excede → reportar y seguir; no bloquear por demoras de infra.

**Frontend web — convenciones específicas de Playwright:**

- **Script obligatorio:** `package.json` debe tener `"test:e2e"`. `/apply` invoca `<pkg-mgr> run test:e2e`, nunca `npm run dev` ni equivalentes.
- **Puerto del webServer: 39847** (rango efímero alto, fuera de los puertos típicos 3000/5173/8080/4200/8000). El puerto se puede sobrescribir con `PLAYWRIGHT_E2E_PORT` si hay conflicto.
- **`webServer` en `playwright.config.ts`:** el propio runner levanta y baja el server. No es responsabilidad de `/apply` lanzar `dev` ni matarlo. Config recomendada:

  ```ts
  // playwright.config.ts
  import { defineConfig } from '@playwright/test';
  const PORT = Number(process.env.PLAYWRIGHT_E2E_PORT ?? 39847);

  export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 30_000,
    reporter: 'line',
    use: { baseURL: `http://localhost:${PORT}` },
    webServer: {
      command: `<pkg-mgr> run dev -- --port ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  });
  ```

- **Carpeta de tests fuera del bundle:** `tests/e2e/` al nivel del repo (no dentro de `app/` ni `src/`). El bundler de producción no la incluye.

**Si el frontend web NO tiene Playwright instalado:**

```
ℹ Detecté <stack> sin Playwright configurado.

`/apply` no tiene gate E2E para esta task. Recomiendo abrir un work-item
de tipo `chore` para integrar Playwright (script `test:e2e`, puerto 39847,
webServer en config, carpeta `tests/e2e/`). Por ahora sigo sin bloquear.

¿Planificar el chore con /plan? (sí/no — no bloquea esta task)
```

Si el dev dice no, continuar sin gate. Si dice sí, dejar la nota en el output y delegar a `/plan` después de cerrar la task actual.

**Comportamiento ante fallos del gate:**

- Analizar el error.
- Corregir el código (**no** modificar los tests para que pasen).
- Volver a correr.
- Si tras 3 intentos sigue fallando → invocar `/debug` con el error específico.

**Tests son parte de la misma task — no una task aparte.** Si la task implementa lógica nueva (feature/fix), el spec del test va en el mismo commit que el código. Excepción: tasks puramente de docs/chore/refactor sin lógica nueva.

### 8. Verificar cobertura mínima

El código nuevo debe tener al menos:
- Happy path cubierto
- Un caso de error cubierto
- Sin tests vacíos (sin asserts)

**Para tasks de UI (Playwright):** spec mínimo del componente — render visible + interacción primaria + un caso de error/validación. Mocks de fetch vía MSW si la UI llama API; nunca depender de backend levantado a mano.

**Excepción de gate:** si la task requiere auth real o un servicio externo y no es practicable mockearlo, declarar `gate: skipped (manual)` en el output con la razón. `/build` lo verá y lo notará en el comentario del commit.

### 9. Marcar subtareas completadas en la task

Editar el body de la task para marcar las subtareas terminadas como `- [x]`. Comentar progreso:

```bash
gh issue comment $TASK_N --body "### Progreso /apply

- [x] <subtarea 1>
- [x] <subtarea 2>
- [ ] <subtarea 3> — en curso

**Tests:** ✓ pasando
**Rama:** \`$(git branch --show-current)\` (work-item)"
```

### 10. ⛔ STOP — fin de invocación

**Una invocación de `/apply` termina aquí.** No leer la siguiente task. No empezar otra task. No saltar a otro work-item del lote. Reportar y devolver el control al dev.

Esto es lo que mantiene el patrón **1 task = 1 commit**: el dev decide cuándo invocar `/build` (que cierra esta task con su propio commit) y luego, si quiere, otro `/apply` para la siguiente task.

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

⛔ Esta invocación de /apply termina aquí.
   Próximo paso: invocar /build para commitear la task #42.
   No voy a continuar con #43 hasta que /build cierre #42 y vuelvas a invocar /apply.
```

## Si el dev necesita pausar el work-item para hacer otra cosa

Caso típico: vas por la task 5 de 10, ya commiteaste 4, y el dev pide trabajar en otra cosa urgente. **No sobreescribir la rama actual con el nuevo trabajo.** El nuevo trabajo va en otra rama, **siempre desde `dev`**.

Pasos:

1. **Asegurar que lo que ya está hecho quede guardado:** llamar a `/build` para commitear y pushear las tasks cerradas hasta el momento. Si hay cambios sin terminar (la task 5 a medio hacer), confirmar con el dev:
   - ¿Commitear como WIP en la rama actual y retomar luego? (recomendado si el cambio compila)
   - ¿Stash con nombre descriptivo? (`git stash push -u -m "wip: <task>"`)
   - ¿Descartar? (solo si el dev lo pide explícitamente)

2. **Las tasks cerradas se quedan cerradas.** Las abiertas del work-item siguen abiertas para retomar después; no hay que tocarlas. El work-item sigue `in-progress` hasta que se complete.

3. **El nuevo trabajo NO se mete en esta rama.** Volver a `dev` (`git checkout dev && git pull --ff-only`) y arrancar el nuevo work-item desde ahí, en su propia rama `<tipo>/<N>-<slug>`. Si no hay work-item para el nuevo trabajo → primero `/plan`, después `/apply`.

4. **Nunca abrir el PR con el work-item a medias.** El PR se abre cuando todas las tasks del work-item están cerradas (ver `/build`). Si el dev presiona por hacer el PR ahora con lo que hay, recomendar mover las tasks pendientes a un work-item de seguimiento (`<tipo>: <título original> — fase 2`) y dejar este work-item con solo lo cubierto.

## Si descubres trabajo nuevo durante la implementación

Si durante el trabajo aparece algo que NO estaba planeado (bug en una task ya cerrada, refactor adicional, detalle faltante):

- **Si forma parte de cerrar BIEN el work-item activo** → crear una nueva task hija del mismo work-item padre (ver sección "Agregar tasks durante el desarrollo" en `/plan`).
- **Si es un problema de algo ya mergeado en producción** → es un nuevo work-item de tipo `fix`, no parte de este. Comunicárselo al dev (puede planearse con `/plan` después).

## Siguiente paso

- **Task implementada y tests OK** → `/build` (commit + push + cerrar task; al ser la última del work-item, ofrecerá PR)
- **Tests fallan después de 3 intentos** → `/debug` con el error específico
- **Detectas que otro issue ya resolvió parte** → `/sync` para reconciliar
- **La task resultó más grande de lo planeado** → `/plan` para dividirla en más tasks

## Notas

- **Una invocación de `/apply` = una task. STOP al terminar.** No se encadenan tasks dentro de la misma invocación. Esto preserva el patrón "1 task = 1 commit" y mantiene el flujo interactivo.
- **No hacer commit dentro de `/apply`** — ese es trabajo de `/build`, siempre con confirmación.
- **No tomar work-items de otros devs.** El paso 2 (chequeo de ownership) es bloqueante.
- **Crear la rama del work-item es responsabilidad de `/apply`,** no de `/plan`. La primera invocación sobre un work-item nuevo es la que la crea desde `dev`.
- **Configurar el push mode una sola vez (paso 3.7).** En la primera invocación sobre el work-item, preguntar al dev y persistir en un comentario del padre. `/build` lo lee en cada commit. Default `on-pr` (push consolidado antes del PR).
- **Nunca modificar tests existentes** para que pasen — solo el código de producción.
- **Costo:** este skill puede consumir muchos tokens. Priorizar Edit sobre Write, grep sobre Read de archivos completos, y pedir contexto al dev antes de explorar.
