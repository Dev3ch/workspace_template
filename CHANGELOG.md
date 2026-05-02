# Changelog

Todas las notas de cambios relevantes de `workspace-template` quedan documentadas aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto usa [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

---

## [1.1.4] — 2026-05-01

Versión centrada en **flujo interactivo correcto y guardrails de granularidad**: `/apply` ya no implementa varias tasks de un tirón ni salta entre work-items, `/build` no agrupa cambios de varias tasks en un solo commit, `/plan` crea **lotes de work-items** con visión completa del trabajo, y se documenta la regla `no-edit-without-plan` como invariante del workspace para evitar ediciones improvisadas en `dev` sin tasks de respaldo. También se introduce **chequeo de ownership multi-dev** para que el equipo pueda tomar piezas distintas del mismo plan sin pisarse.

### Why

Caso real reportado por el dev: una sesión de Claude con la versión anterior implementó **4 tasks (#209, #210, #211, #212) en una sola invocación de `/apply`** y luego `/build` cerró todo con un único commit, dejando esas 4 tasks abiertas en GitHub aunque el código ya estaba hecho — board desincronizado del código. La auto-crítica de esa sesión apuntó al gap exacto: **`/apply` decía "trabajar una task a la vez" como nota al final, no como barrera**, y `/build` no validaba que el diff correspondiera a una sola task. Esta versión convierte esas reglas en **STOP gates** explícitos.

Adicionalmente, casos donde el dev arranca chateando ("modifica X", "agrega Y") y Claude iba directo a `dev` sin pasar por `/plan` — la regla de "nunca crear código sin work-item previo" estaba como sugerencia, no como guardrail bloqueante. Ahora es una regla dura `no-edit-without-plan` enforced en `/init`, `/apply` y CLAUDE.md.

### Added

- **`/plan` soporta lote de N work-items cuando los alcances son inconexos.** Default sigue siendo **1 work-item por `/plan`** — eso es lo normal. Solo se crean varios cuando el dev mencionó temas **temáticamente independientes** entre sí (ej: "onboarding de usuario" + "refresh token JWT" → dos work-items distintos). Tener muchas tasks coherentes (todas alrededor del mismo tema) **no es razón para partir** — un work-item con 8-12 tasks coherentes está bien. Cuando se detectan múltiples áreas, `/plan` pregunta al dev antes de asumir. Output del lote: visión completa con #IDs y nombres de ramas futuras antes de empezar.
- **`/apply` STOP gate explícito (paso 10).** Una invocación de `/apply` = una task. Al terminar de implementar y correr tests, `/apply` se detiene y reporta. **No lee la siguiente task. No salta a otro work-item.** El output incluye una marca visible `⛔ Esta invocación de /apply termina aquí` con el próximo paso esperado (`/build`).
- **`/apply` chequeo de ownership multi-dev (paso 2).** Antes de tomar un work-item, `/apply` revisa `assignees` y label `in-progress` en GitHub:
  - **Caso A** (libre) → se asigna el work-item al dev y agrega `in-progress` (lockea para el equipo).
  - **Caso B** (ya es del dev actual) → continúa.
  - **Caso C** (asignado a otro dev con `in-progress`) → **bloquea**, avisa, ofrece otros work-items libres del lote. Nunca pisa trabajo ajeno.
- **`/apply` crea la rama del work-item desde `dev` (paso 4).** Antes era responsabilidad de `/plan` ofrecer crearla; ahora `/plan` solo crea issues y `/apply` es quien materializa la rama cuando alguien arranca el work-item. Evita ramas vacías huérfanas en remoto si un work-item del lote nunca se toma.
- **`/apply` guardrail `no-edit-without-plan` (paso 0.5).** Si no hay work-item asignado al dev en `in-progress` con tasks abiertas, `/apply` rechaza la edición y redirige a `/plan`. Cubre el caso donde el dev invoca `/apply` por inercia sin haber planificado.
- **`/build` guardrail "diff multi-task" (paso 1).** Si el diff actual toca archivos atribuibles a más de una task abierta, `/build` **bloquea** el commit y obliga a partir: ofrece commitear solo los archivos de la task activa o cancelar para revisar manualmente con `git add -p`. Heurística de atribución por scope/notas técnicas/path; en caso de ambigüedad pregunta al dev. Esto enforce el patrón "1 commit = 1 task" que antes estaba como nota.
- **`/build` pregunta nueva tras la última task del work-item (paso 6).** En lugar de proponer PR automáticamente, ofrece tres caminos: (1) abrir PR ahora, (2) agregar más tasks al work-item antes de cerrar (vuelve a `/plan` modo agregar), (3) dejar el work-item sin PR aún. El dev decide cuándo está realmente "completo".
- **`/build` ofrece el siguiente work-item del lote tras el merge (paso 8).** Cuando `/build` detecta que el PR mergeó y limpia el work-item padre, lista los **otros work-items** del repo agrupados por ownership: tuyos sin empezar, libres del lote, y (solo informativo) los tomados por otros devs. Pregunta si tomar uno antes de cerrar la sesión.
- **`/init` muestra el lote completo con ownership (paso 5).** El listado se divide en tres grupos: work-items tuyos en progreso, tuyos sin empezar, y libres del lote. Las opciones del menú incluyen "Tomar un work-item libre del lote" (delegando a `/apply` para que valide ownership y cree rama).
- **`/init` guardrail `no-edit-without-plan` mid-chat (paso 6.5).** Si el dev pide editar código en cualquier momento de la sesión sin un work-item activo, `/init` redirige a `/plan` con un mensaje accionable. Cubre el caso real donde el dev arranca chateando "modifica X" sin planificar.
- **`CLAUDE.md.hbs` reglas operativas 13.1, 13.2, 13.3, 13.4** documentan los invariantes de granularidad (1 `/apply` = 1 task, 1 `/build` = 1 commit), el modelo de lotes en `/plan`, y el chequeo de ownership multi-dev en `/apply` y `/build`.
- **`CLAUDE.single.md.hbs` regla 6 reescrita** con el principio `no-edit-without-plan` y reglas 7-9 con la granularidad y ownership invariantes.
- **Gate de tests por stack en `/apply` paso 7 — detección automática + comando one-shot, no-interactivo.** Nueva función `detectTestCapabilities(repoPath)` en [lib/stack-detect.js](lib/stack-detect.js) que devuelve `{ kind, stacks, gate: { framework, cmd, timeoutSec }, suggestions }`. Mapeo:
  - **Django con pytest** → `uv run pytest -x -q --tb=short` (180s)
  - **Django sin pytest** → `python manage.py test --keepdb -v 1` (180s)
  - **FastAPI** → `uv run pytest -x -q --tb=short` (180s)
  - **Go** → `go test -short -count=1 ./...` (180s)
  - **Flutter** → `flutter test --reporter compact` (180s)
  - **React Native con jest** → `<pkg-mgr> test -- --ci --reporters=default` (120s)
  - **Frontend web (Next/React/Vue/Nuxt) con Playwright** → `<pkg-mgr> run test:e2e` (240s)
  - **Frontend web sin Playwright** → no bloquea, sugiere abrir chore para integrarlo

  Convenciones del gate: `CI=true`, sin watchers, sin browsers headed, sin prompts, timeout duro por gate. Mocks > datos reales (MSW para frontend que llama API). Nunca pedir credenciales reales al dev — si la task requiere auth real y no es mockable, declara `gate: skipped (manual)` y sigue.
- **Detección de package manager (`detectPackageManager`) por lockfile.** Orden de prioridad: `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lockb`/`bun.lock` → `bun`, fallback `npm`. Todos los comandos JS/TS del gate respetan el package manager detectado en lugar de asumir `npm`.
- **Frontend web — Playwright como gate único.** Decisión del workspace: en frontend web no se usa Vitest/Jest unitario como gate; Playwright cubre el flujo real del usuario en navegador, que es lo que importa para apps. El dev puede correr unitarios a mano si quiere, pero `/apply` no los invoca. Convenciones obligatorias en [templates/rules/tests.md](templates/rules/tests.md):
  - **Script `test:e2e` en `package.json`** (no `dev` ni `start` — esos chocan con comandos clásicos).
  - **Puerto `39847` para el webServer** de Playwright (rango efímero alto, fuera de 3000/5173/8080/4200/8000). Configurable con `PLAYWRIGHT_E2E_PORT`.
  - **`webServer` configurado en `playwright.config.ts`** — el runner levanta y baja el server local con `reuseExistingServer: !CI`. `/apply` nunca arranca `npm run dev` aparte.
  - **Carpeta `tests/e2e/`** al nivel del repo, fuera de `app/` y `src/` — el bundler de producción no la incluye.
  - **Headless siempre** en el gate. `--headed` queda para debug manual del dev.
- **`templates/rules/tests.md` extendido con sección "Gate de tests por stack"** — tabla de comandos por stack, convenciones de Playwright (script, puerto, webServer, carpeta), spec mínimo de UI (happy path + caso de error), y el patrón para frontend sin Playwright (no bloquea, sugiere chore de integración con pasos concretos: instalar `@playwright/test`, `playwright install --with-deps`, crear config, agregar script, crear carpeta, actualizar `.gitignore`).
- **Tests son parte de la misma task — no una task aparte.** Documentado en `/apply` paso 7 y `CLAUDE.md.hbs`. El commit que cierra la task incluye código + spec del test (excepto tasks puramente de docs/chore/refactor sin lógica nueva).

### Changed

- **Regla `no-edit-without-plan` ascendida a invariante del workspace.** Antes era una sugerencia ("Si el dev pide implementar algo y no hay work-item visible, preguntar si quiere crear el plan primero con `/plan`"). Ahora en `CLAUDE.md.hbs` regla 6 es **rechazo bloqueante**: Claude no edita código de producción sin work-item de respaldo, sin excepciones (salvo auditorías de lectura, edición de `.claude/`, y hotfix explícitamente autorizado por el dev). El cambio aplica tanto al inicio de la sesión como mid-chat.
- **`/plan` ya no crea ramas.** Antes el paso 8 ofrecía crear la rama `<tipo>/<N>-<slug>` desde `dev` al final. Ahora `/plan` solo crea issues + sub-issues + links al Project. La rama es responsabilidad de `/apply` cuando alguien arranque el work-item específico. Razón: con lote de N work-items, crear N ramas vacías ensucia el remoto y muchas pueden no usarse nunca.
- **`/apply` paso 1: si hay más de un work-item `in-progress` del dev, pregunta cuál tomar.** Antes asumía el primero.
- **`/build` paso 5 reorganizado:** si quedan tasks abiertas, pregunta `¿continuamos con la siguiente?` con opción de parar. Si se confirma, marca la siguiente con `in-progress` y delega a `/apply` (que pasará por su STOP gate al terminar).
- **`/build` paso 6 ya no abre PR automáticamente** tras cerrar la última task. Pregunta primero los tres caminos (abrir PR / agregar tasks / dejar sin PR).
- **`/init` query de issues extendida con segunda búsqueda de work-items libres** (`no:assignee`) para mostrar el lote completo del plan. Antes solo mostraba los asignados al dev.
- **Output esperado de `/init`** incluye sección "Work-items libres del lote" y opción de menú para tomarlos.

### Fixed

- **Caso real: `/apply` implementaba múltiples tasks de un tirón sin pausar.** Sesiones reales reportaron que `/apply` leía las 4 tasks abiertas, las implementaba todas seguidas, y solo al final el dev invocaba `/build`, que terminaba colapsando 4 tasks en 1 commit y dejando las otras 3 tasks abiertas en GitHub. La regla "una task a la vez" estaba como nota textual al final de `/apply`, no como barrera. Ahora el paso 10 de `/apply` es un STOP gate explícito con marca visible en el output, imposible de saltar sin desobedecer la skill.
- **Caso real: `/build` agrupaba diff multi-task en un solo commit.** No había validación de que los archivos cambiados correspondieran a una sola task. El paso 1 ahora detecta archivos atribuibles a más de una task abierta y bloquea el commit hasta que el dev parta el cambio. Heurística por scope/notas técnicas/path con fallback de pregunta al dev.
- **Caso real: Claude editaba `dev` mid-chat sin work-item.** El dev arrancaba chateando "modifica X", "agrega Y" y Claude iba directo a `dev` a editar. La regla "nunca crear código sin work-item previo" estaba como sugerencia ("preguntar si quiere crear el plan primero"), no como bloqueo. Ahora `no-edit-without-plan` es regla dura en `CLAUDE.md.hbs` (regla 6), `/init` paso 6.5 y `/apply` paso 0.5 — Claude rechaza la edición y redirige a `/plan` antes de tocar nada.
- **Multi-dev: dos devs podían tomar el mismo work-item del lote sin saberlo.** No había validación de ownership; la rama `<tipo>/<N>-<slug>` se creaba al arrancar y el segundo dev se encontraba con la rama ya en remote sin contexto. El paso 2 de `/apply` ahora chequea `assignees` + label `in-progress` y bloquea si está tomado por otro dev. Cuando un dev libre toma un work-item, `/apply` se asigna el issue + agrega `in-progress` (lockea visiblemente para el equipo); cualquier `/init` posterior de otro dev verá el work-item como tomado y no lo ofrecerá.
- **Tras el merge, `/build` no orientaba al siguiente trabajo.** El dev quedaba en limbo después del cierre del work-item. El paso 8 ahora lista los work-items abiertos restantes filtrados por ownership y ofrece tomar el siguiente del lote o terminar la sesión.

---

## [1.1.3] — 2026-04-29

Versión centrada en **sincronización completa del workspace + ciclo de PR explícito + producción no-destructiva + skills generadores con work-item + sub-issues**:

1. El comando `update` ahora propaga también los GitHub issue templates, el `pull_request_template.md`, regenera `CLAUDE.md` desde el template upstream y genera/sincroniza un `docs/QUICK_START.md` por repo — todo sin pisar cambios locales.
2. `/build` agrega un paso 6.5 donde el dev elige cómo cerrar el PR (review humano, self-merge, auto-merge, asignar reviewer) en lugar de dejar el PR sin instrucciones.
3. `/deploy` reescrito para **detectar producción ya enlazada** (Vercel, Fly, Railway, workflows) y **no reconfigurar** si todo está sano.
4. Los skills `/pentest`, `/audit`, `/secure` y `/deploy` ahora siguen todos el mismo patrón work-item + sub-issues nativos: cuando hay trabajo accionable, crean un padre con tasks vinculadas en lugar de un issue plano o un solo reporte.
5. README reorganizado: el diagrama grande del flujo y las reglas detalladas se mueven a `docs/flujo-arquitectura.md`. El README queda con quickstart + dos ejemplos (paginación + drift contra `dev`) + tabla de comandos.

### Added

- **Sincronización de GitHub templates en `npx workspace-template update`** — `updater.js` y `computeDiff` ahora incluyen un nuevo kind `github` que rastrea los 6 archivos de `.github/ISSUE_TEMPLATE/` y `.github/pull_request_template.md`. Los cambios upstream se clasifican como `new`, `updated`, `customized` (editado localmente), `deletedByUser` o `removed`, con la misma semántica que skills y rules.
- **Regeneración de `CLAUDE.md` en `update`** — cuando el `.hbs` upstream cambia y el `CLAUDE.md` local sigue siendo el último render sin editar, se regenera automáticamente con el contexto guardado. Si el dev editó `CLAUDE.md` a mano, aparece como `customized` y pregunta antes de sobrescribir.
- **`templates/docs/QUICK_START.md.hbs` + `generateQuickStart`** — un **documento de inicio rápido por repo** con el ejemplo real (`/init` → `/plan` → `/apply` → `/build` → review → merge → `/deploy`) y la cheatsheet de comandos. Se genera en `<repoPath>/docs/QUICK_START.md` durante el setup de cada repo (single y multi), de modo que el dev no necesita ir al repo de `workspace-template` para entender el flujo.
- **Sincronización de `docs/QUICK_START.md` en `update`** — mismo patrón que `CLAUDE.md`: si el `.hbs` upstream cambia y el archivo local sigue siendo el último render, se regenera. Si fue editado a mano, queda como `customized` y pregunta antes de sobrescribir. Helper genérico `diffHbsDoc` cubre cualquier doc Handlebars-rendered.
- **Contexto de generación persistido en `.workspace-version`** — `generateMultiRepoCLAUDE`, `generateSingleRepoCLAUDE` y `generateQuickStart` guardan ahora `claudeMd.context` y `quickStart.context` (todos los parámetros del template), junto con `templateHash` y `lastRenderedHash`. Esto permite a `update` regenerar los docs en cualquier momento sin intervención manual.
- **Hashes de GitHub templates en `.workspace-version`** — `generateIssueTemplates` registra los hashes bajo la clave `github` (clave = ruta destino relativa al repo).
- **Estado `missingContext` para workspaces pre-1.1.3** — si el workspace fue generado con una versión que no persistía el contexto de generación, `update` reporta `CLAUDE.md: missingContext` (y lo mismo para `quickStart`) y los omite con un aviso en lugar de crashear.
- **`/build` paso 6.5 — Elegir camino de review/merge del PR.** Tras abrir el PR, Claude pregunta explícitamente cómo cerrar el ciclo. Cuatro opciones: (1) **dejar para review del equipo** (default), (2) **mergear el dev mismo ahora** con `gh pr merge --squash --delete-branch`, (3) **auto-merge cuando pasen los checks** con `gh pr merge --auto`, (4) **asignar reviewer específico**. Nunca mergea sin pedido explícito; si el dev no eligió 2/3, el default es dejar el PR abierto.
- **`/deploy` con auto-detección de producción ya enlazada (paso 0/0.5).** Antes de preguntar nada, escanea: `vercel.json`, `.vercel/project.json`, `fly.toml`, `railway.json`, `render.yaml`, `netlify.toml`, `firebase.json`, `Dockerfile`, workflows de deploy en `.github/workflows/`, runs recientes via `gh run list`, releases, branches protegidas y secrets configurados. Clasifica el estado en 4 casos:
  - **Caso A** — ya en producción + CI/CD activo → reportar salud, **no reconfigurar**, salir con `✓`.
  - **Caso B** — configs presentes pero sin workflow → ofrecer migrar a CI/CD.
  - **Caso C** — nada detectado → setup completo.
  - **Caso D** — ambiguo → preguntar al dev.

### Changed

- **`/pentest` reescrito para usar work-item + sub-issues nativos** — el skill ahora sigue exactamente el mismo patrón que `/plan`:
  - Crea un **work-item padre** tipo `chore` con labels `chore,pentest,security`.
  - Crea **una task (sub-issue nativo) por cada hallazgo** usando la mutación `addSubIssue` de GraphQL.
  - Aplica **labels de severidad** (`severity-critical`, `severity-high`, `severity-medium`, `severity-low`) y de categoría en cada task.
  - El body de cada task incluye descripción del problema, impacto y **remediación propuesta** (no solo la descripción del hallazgo).
  - Findings `Info` van como checkboxes en el body del padre, sin abrir tasks.
  - Padre y todas las tasks se agregan al **GitHub Project** del workspace.
- **`/audit` migrado al modelo work-item + sub-issues** — antes terminaba en `gh issue create` plano con todo el reporte mezclado. Ahora, cuando hay hallazgos Critical/High/Medium en el PR auditado:
  - Crea **work-item padre `[AUDIT] fix`** con labels `fix,audit,security`.
  - **Una task (sub-issue nativo) por hallazgo** Critical/High/Medium con `addSubIssue`. Labels de severidad + categoría OWASP (`A01`..`A10`, `business-logic`, `hardening`).
  - Body de cada task: descripción, impacto, **remediación con diff propuesto**, subtareas, criterios de aceptación.
  - Hallazgos **Low/Info** no abren task — van como comentarios en el PR o checkboxes en el body del padre.
  - Si no hay hallazgos accionables → `/audit` reporta ✓ y no crea nada en GitHub.
  - Padre y tasks se agregan al GitHub Project del workspace.
- **`/secure` migrado al modelo work-item + sub-issues** — antes creaba un issue plano con checklist cuando había bloqueantes. Ahora, cuando el checklist pre-deploy detecta bloqueantes:
  - Crea **work-item padre `[SECURITY] fix`** con labels `fix,security,blocker`.
  - **Una task por bloqueante** con `addSubIssue`. Labels de severidad + categoría del check (`env-vars`, `secrets`, `gitignore`, `deps`, `dockerfile`, `ci`, `prod-config`, `tests`).
  - Body de cada task: check fallido, ubicación, impacto, **comando concreto de remediación**, subtareas, criterios de aceptación.
  - Warnings no bloqueantes van como checkboxes en el body del padre, sin abrir task.
  - Si pasa todo el checklist → `/secure` reporta ✓ y permite `/deploy` sin crear nada en GitHub.
  - Padre y tasks se agregan al GitHub Project del workspace.
- **`/deploy` migrado al modelo work-item + sub-issues** — antes generaba archivos sin estructurar el trabajo restante en GitHub. Ahora, según el caso del diagnóstico:
  - **Caso A** (producción ya sana) → no crea nada, sale con ✓.
  - **Caso B** (migración a CI/CD) → **work-item padre `[DEPLOY] chore`** con tasks **solo de los componentes faltantes** (típicamente `component-workflow`, `component-secrets`, `component-firstdeploy`).
  - **Caso C** (setup completo) → work-item con todas las tasks aplicables (`component-docker`, `component-workflow`, `component-env`, `component-secrets`, `component-gitignore`, `component-firstdeploy`).
  - Cada task tiene su propia plantilla con título, qué archivo se genera/modifica, criterios de aceptación, esfuerzo estimado y referencia al padre.
  - Padre y tasks se agregan al GitHub Project. Se crea la rama `chore/<N>-deploy-<provider>` y se delega a `/apply` por task siguiendo el flujo normal.
- **README reorganizado para reducir la curva de entrada** — antes contenía dos diagramas Mermaid grandes (flujo completo + modelo work-item) y la sección de comandos de soporte, todo de corrido. Eso podía abrumar a quien recién llega. Ahora:
  - El diagrama grande del flujo completo, el diagrama del modelo work-item + sub-issues, las reglas del flujo y los comandos de soporte se mueven a **`docs/flujo-arquitectura.md`**.
  - El README queda con: gancho + qué te da + quickstart + ejemplo paso a paso (paginación) + **segundo ejemplo nuevo: drift contra `dev` con rebase + conflicto** + tabla compacta de comandos del flujo principal + lista plana de los soportes.
  - Pasa de ~360 líneas a 276.
- **`writeVersionMetadata` en `workspace-gen.js` ahora preserva `claudeMd`, `quickStart`, `github` y `githubProject`** al regenerar la sección de skills/rules/scripts. Evita pisar metadata escrita por `generateMultiRepoCLAUDE` / `generateSingleRepoCLAUDE` / `generateIssueTemplates` cuando se llaman antes de `generateClaudeDir`.
- **`mergeVersionMetadata` extendido** para fusionar también las claves `quickStart` y `claudeMd` (antes solo skills/rules/scripts/github/githubProject).
- **`applyUpdates` en `updater.js`** extiende su loop a `github` y maneja `claudeMd` y `quickStart` — la regeneración de docs llama a Handlebars con el contexto guardado, escribe el archivo y actualiza `lastRenderedHash` + `templateHash` en `.workspace-version`.
- **`bin/workspace-template.js`** — todos los `git add` del setup ahora incluyen `docs/` para que el commit inicial cubra `docs/QUICK_START.md`. El `git add` post-update en `runUpdate` también lo incluye.
- **README — ejemplo paso a paso completado** — el caso `GET /users` cubre ahora también: (a) la pregunta de cómo cerrar el PR tras `/build`, (b) la limpieza automática post-merge (cierre del work-item, tasks colgantes, oferta de borrar la rama), (c) el camino de `/deploy` cuando producción ya existe.

### Fixed

- **`npx workspace-template update` no reflejaba cambios en issue templates ni en `pull_request_template.md`** — era necesario editarlos manualmente en cada proyecto después de modificarlos en el template base. Ya no.
- **`npx workspace-template update` no regeneraba `CLAUDE.md` aunque el `.hbs` upstream hubiera cambiado** — el archivo quedaba desincronizado y había que reescribirlo a mano. Ya no.
- **`/deploy` "improvisaba" setup completo aunque producción ya estuviera enlazada y sana** — re-generaba `Dockerfile`, workflows y `.env.example` que ya estaban en uso, desconfigurando el sistema. Ahora detecta primero el estado real y, si todo está sano, **sale sin tocar nada**.
- **`/build` dejaba el PR abierto sin instrucciones explícitas sobre quién mergea** — implícitamente el dev tenía que recordar que era review humano. Ahora se pregunta y queda registrado en la sesión.
- **`/audit`, `/secure`, `/deploy` producían issues planos o solo reportes en pantalla** — sin estructura accionable. Cada hallazgo, bloqueante o componente quedaba mezclado en un único checklist, imposible de delegar o trackear individualmente. Ahora siguen el mismo modelo work-item + sub-issues que `/plan` y `/pentest`: el reporte se traduce automáticamente en tasks vinculadas que se trabajan con `/apply` y cierran como un PR único cuando todas terminan.

---

## [1.1.2] — 2026-04-28

Versión centrada en **arranque rápido y predecible**: `/init` deja de "improvisar" cuando hay problemas de credenciales o cuando el repo tiene miles de issues. El cambio de rama es seguro (nunca pisa trabajo del dev), el updater respeta tus borrados locales, los commits siempre se confirman, y al mergear un PR todo el work-item queda limpio en automático.

### Added

- **`templates/scripts/gh-isolated.sh`** — wrapper que carga `.claude-credentials` y aísla `gh` con un `GH_CONFIG_DIR` efímero por sesión, ignorando el keyring del SO. Si el token no valida contra el repo, hace **fail-fast** con un solo `curl` y mensaje accionable. Resuelve el caso "el keyring tiene otra cuenta y `gh` la prefiere sobre `$GH_TOKEN`".
- **Regla anti-improvisación en `/init`** — si `gh-isolated.sh` falla, **no** se intentan `gh auth switch`, configs paralelos con `mktemp`, ni `gh auth login --with-token`. Se reporta el error y se para. El dev arregla `.claude-credentials` y vuelve a correr.
- **Limpieza automática de estados zombies en `/init`** (paso 1.7) — work-items cerrados con label `in-progress`/`review` se sanean en una sola query.
- **`/apply` paso 9.1: pausar work-item a la mitad** — si el dev necesita parar y trabajar otra cosa, se documenta el procedimiento (commit/stash de lo hecho, las tasks pendientes quedan abiertas, el nuevo trabajo arranca desde `dev` en su propia rama). Nunca se abre un PR con work-item a medias; lo no hecho se mueve a un work-item de fase 2.
- **`/build` paso 8: cierre automático tras el merge** — al detectar que el PR fue mergeado, el work-item padre se cierra, las tasks colgantes se cierran referenciando el PR, los labels intermedios se quitan, y se ofrece borrar la rama (esto sí se confirma). **Nada queda `in-progress` si el work-item está completo.**
- **Categoría `deletedByUser` en el updater** — si un archivo del template estaba en el registry pero el dev lo borró localmente, ya no se reinstala automáticamente. Aparece en la lista marcado con `×` y default unchecked; reaparece solo si el dev lo selecciona explícitamente.

### Changed

- **`/init` paso 0.5 reescrito: cambio de rama con tres casos explícitos.** Antes hacía `git checkout dev` ciegamente. Ahora detecta:
  - Caso A — ya estás en `dev` → solo `pull`.
  - Caso B — otra rama, working tree limpio, sin commits sin push → mover sin riesgo.
  - Caso C — hay cambios pendientes (working tree sucio o commits locales sin push) → **NO mover.** Se ofrecen tres opciones: commit/push y luego ir a `dev`, `git stash` y luego ir a `dev`, o quedarse en la rama actual para esta sesión. Nunca se usa `checkout -f` ni `reset --hard`.
- **`/init` paso 2: query server-side para issues pendientes.** Antes traía todos los issues asignados y filtraba localmente. Ahora usa `search/issues` con el filtro `repo:$GH_REPO is:issue is:open assignee:$GITHUB_USER label:feature,refactor,fix,chore` — un solo round-trip, `per_page=50`. Aunque el repo tenga miles de issues, solo viajan los relevantes para el dev en este momento.
- **Tasks (sub-issues) solo se cargan para work-items en progreso, y solo las `OPEN`.** Las cerradas se citan por número pero no se leen — su trabajo ya está commiteado y leerlas solo gasta tokens.
- **`/build` paso 2: confirmación obligatoria por cada commit, sin excepciones.** La autorización es por commit, no por sesión. Aunque sea el décimo commit del día, se pregunta.
- **`/build` paso 6: regla dura "PR solo con todo culminado".** No se abren PRs preliminares ni de progreso. Si el dev quiere parar a la mitad, ver `/apply` 9.1.
- **`/apply` lectura mínima de issues** — body del work-item padre + tasks **abiertas** únicamente. Las cerradas no se cargan.
- **Las 14 skills (`init`, `apply`, `build`, `plan`, `sync`, `review`, `triage`, `branches`, `debug`, `rollback`, `audit`, `pentest`, `secure`, `deploy`)** ahora hacen `source .claude/scripts/gh-isolated.sh` al inicio de cada Bash call. Es idempotente (reusa el `GH_CONFIG_DIR` de la sesión) y elimina el problema de "cada call es un proceso nuevo y `$GH_TOKEN` se pierde".

### Removed

- **Referencias a "epic" en templates y skills.** El concepto fue reemplazado por work-item en `1.1.0`, pero quedaban menciones residuales en `triage.md` ("epic audit", "epic completed"), `setup.md` (árbol `.github/` con `epic.md`) y `CLAUDE.single.md.hbs` ("Plan de un epic"). Todas reescritas en términos de work-item / tasks.

### Fixed

- **`/init` ya no demora ni "da vueltas" con repos privados cuando el keyring tiene otra cuenta.** Antes, en un repo donde el keyring tenía un usuario sin acceso, `/init` hacía 8+ llamadas creativas (`gh auth switch`, `mktemp` con `GH_CONFIG_DIR`, `gh auth login --with-token` que pedía login interactivo) hasta encontrar la combinación que funcionaba. Ahora el wrapper resuelve esto en una sola pasada al inicio.

---

## [1.1.1] — 2026-04-28

Versión centrada en **drift detection**: cuando varios devs trabajan en paralelo, las ramas de work-items se quedan atrás de `dev` mientras otros van mergeando. Claude ahora chequea drift en puntos naturales del flujo y ofrece sincronizar (rebase / merge) con confirmación, sin nunca hacerlo solo. También se ajusta la pregunta de stack para repos sin manifest detectable.

### Added

- **Drift detection en `/init`** — después de posicionarse en `dev`, lista las ramas locales de work-items (`feature/*`, `refactor/*`, `fix/*`, `chore/*`, `hotfix/*`) que están atrás de `origin/dev` y ofrece sincronizarlas. Default: rebase. Si hay commits pusheados compartidos: ofrece merge.
- **Drift detection en `/apply`** — antes de tocar código, si la rama del work-item está atrás de `dev`, avisa y ofrece rebase / merge / continuar. Tras un chequeo se marca `_DRIFT_LAST_CHECK_AT` para no rechecar en los próximos 10 minutos.
- **Drift detection en `/build`** — chequeo silencioso antes del push (heads-up si dev avanzó) y chequeo **bloqueante** antes de abrir el PR. Si la rama está atrás, el PR no se abre hasta sincronizar — evita conflictos en GitHub y diff sucio para el reviewer.
- **Regla operativa 16 en `CLAUDE.md.hbs`** — documenta los puntos de chequeo, las estrategias (rebase como default, merge si la rama es compartida, `--force-with-lease` nunca `--force` puro), y la garantía de que Claude nunca rebasa ni mergea solo.
- **Triggers por intención textual** — "¿estamos al día?", "actualízame la rama", "¿hubo cambios en dev?" → trigger inmediato del chequeo.

### Fixed

- **Pregunta de stack innecesaria al clonar repos sin manifest detectable.** Cuando se incorporaba un repo existente que no tenía `package.json`, `pyproject.toml`, `go.mod`, etc. (típicamente plantillas, repos de configuración o agentes), el CLI forzaba a elegir uno de los stacks tradicionales aunque no aplicara. Ahora `resolveStacks` pregunta primero si el repo realmente usa un stack tradicional antes de mostrar la lista; si el dev dice no, continúa con stack vacío y el `CLAUDE.md` se genera con `Sin stack específico`.
- **`stackLabel([])` devolvía string vacío** que se renderizaba como `Stack: ` en el `CLAUDE.md`. Ahora devuelve `Sin stack específico` cuando no hay stacks asociados.

---

## [1.1.0] — 2026-04-28

Versión centrada en **modelo work-item / task**: reemplaza el concepto de "épica + sub-issues" por un patrón generalizado y alineado con la industria. Cualquier trabajo se planifica como un **work-item padre** (`feature`, `refactor`, `fix` o `chore`) que agrupa **tasks** vinculadas nativamente como sub-issues. Una rama por work-item, un commit por task, **un solo PR al cerrar el work-item**.

### Changed

- **Renombrado: épica → work-item.** Más estándar en la industria (Linear, GitHub, Vercel, Stripe). El work-item puede ser de cuatro tipos: `feature`, `refactor`, `fix`, `chore`. Las tasks (antes "sub-issues") son las piezas concretas dentro.
- **El tipo del work-item determina el prefijo de la rama:** `feature/<N>-<slug>`, `refactor/<N>-<slug>`, `fix/<N>-<slug>`, `chore/<N>-<slug>`. Las ramas viejas `feat/issue-N-...` ya no se usan.
- **Conventional Commits con doble referencia:** `<tipo>(<scope>): descripción (#task-N) — <tipo-padre> #parent-N`. El tipo del commit refleja la task, no el work-item padre. Permite mezclar tipos dentro de un mismo work-item (ej: una feature puede tener tasks de tipo `feat`, `refactor`, `test`, `docs`).
- **Un solo PR por work-item, abierto solo cuando todas las tasks están cerradas.** No hay PR por task. El PR cierra el work-item padre y todas sus tasks (`Closes #parent-N`, `Closes #task-1`, ...).
- **`/plan` reescrito completamente:** propone work-item + tasks, pide confirmación antes de crear nada, vincula tasks al padre vía `addSubIssue` GraphQL, agrega todo al GitHub Project, ofrece arrancar la rama del work-item al final.
- **`/apply` trabaja sobre la rama del work-item:** identifica el work-item activo y la task en `in-progress`, lee plan de la task + contexto del padre, valida que la rama actual sea `<tipo>/<N>-<slug>`. Una task a la vez.
- **`/build` con confirmación obligatoria** antes de cada commit, push y apertura de PR. Cada task cerrada genera un commit. El PR del work-item se ofrece solo cuando todas las tasks están cerradas.
- **`/init` muestra work-items y tasks agrupadas:** presenta los work-items en progreso con sus tasks anidadas, los work-items asignados sin empezar, y pregunta explícitamente al dev qué quiere hacer.
- **`templates/CLAUDE.md.hbs`**: reglas operativas 11-15 documentan el modelo work-item completo (work-item padre, tasks vinculadas nativamente, prefijo de rama según tipo, PR único, confirmación obligatoria, manejo de trabajo descubierto durante la implementación).
- **`templates/rules/branching.md`** y **`templates/rules/commits.md`**: actualizados para reflejar el nuevo patrón con ejemplos concretos.

### Added

- **Templates de issue por tipo de work-item:**
  - `templates/github/ISSUE_TEMPLATE/feature.md` — work-item de tipo feature
  - `templates/github/ISSUE_TEMPLATE/refactor.md` — work-item de tipo refactor (nuevo)
  - `templates/github/ISSUE_TEMPLATE/chore.md` — work-item de tipo chore (nuevo)
  - `templates/github/ISSUE_TEMPLATE/bug.md` — work-item de tipo fix (renombrado en propósito)
  - `templates/github/ISSUE_TEMPLATE/task.md` — task hija de cualquier work-item (nuevo)
- **Soporte para descubrir trabajo durante el desarrollo:** si aparece algo nuevo mientras trabajas, `/apply` y `/plan` documentan cuándo crear una nueva task hija del mismo padre vs cuándo abrir un nuevo work-item separado de tipo `fix` (el criterio: "¿es para cerrar bien lo que estoy haciendo, o es un problema de algo ya en producción?").
- **`pull_request_template.md`** estructura el PR alrededor del work-item: lista las tasks cerradas, marca el tipo del work-item, checklist específico (todas las tasks cerradas, cada task con commit propio).

### Removed

- **`templates/github/ISSUE_TEMPLATE/epic.md`** eliminado. Reemplazado por `feature.md` (con la terminología nueva) y los nuevos templates `refactor.md` y `chore.md`. Si un proyecto venía con `epic.md` instalado, `/update` lo detecta como obsoleto y ofrece eliminarlo.

---

## [1.0.9] — 2026-04-27

Versión centrada en **flujo conversacional y autonomía de Claude**: el dev ya no necesita escribir cada slash command — Claude interpreta la intención, propone el plan, pide confirmación y ejecuta el flujo completo. Además se corrige que los commits del setup iban a `main` en lugar de `dev`.

### Fixed

- **Commits del setup ahora van en `dev`, no en `main`** — `normalizeRepoBranches` hace `git checkout dev` al terminar, garantizando que los commits de config de Claude Code queden en `dev`. En el flujo desde cero: primer commit inicial en `main` (necesario para crear `dev` desde ahí), luego checkout a `dev` y segundo commit con la config de Claude.
- **Context7 se instalaba con `npx` cada vez** — cambiado a `npm install -g @upstash/context7-mcp`. Ya no descarga el paquete en cada invocación. La detección de si ya está instalado usa `which context7-mcp` en lugar de `--version` (que el paquete no implementa).
- **`uipro` también detectado por `which`** — consistente con el fix de Context7.

### Changed

- **`/plan` es conversacional** — nuevo paso 4: muestra el plan completo al dev antes de crear ningún issue y pide confirmación. Si el dev dice no, ajusta antes de continuar. Nuevo paso 9: después de crear los issues pregunta si arrancar con el primero ahora — si confirma, crea la rama `feat/issue-N-...` desde `dev`, la pushea, y asigna el issue con label `in-progress`.
- **`/init` pregunta explícitamente qué hacer** — presenta el estado completo (issues en progreso, asignados, PRs) y ofrece opciones numeradas: continuar un issue en progreso, empezar uno asignado, planificar algo nuevo, u otra cosa. No asume ni avanza sin respuesta del dev.
- **Flujo conversacional documentado en `CLAUDE.md.hbs`** — nueva regla 10: Claude ejecuta el flujo completo (`/plan` → issues → rama → `/apply` → `/build`) de forma autónoma en respuesta a lenguaje natural. El dev guía con texto; Claude avanza sin esperar que escriba cada slash command.

### Added

- **`ensureClaudeCredentialsIgnored(repoPath)`** exportada como función pública en [lib/github.js](lib/github.js) — se llama en los 3 flujos de setup (single GitHub, single local, multi-repo) garantizando que `.claude-credentials` esté en `.gitignore` con o sin `projectToken`.

---

## [1.0.8] — 2026-04-27

Versión centrada en **simplificación del flujo** y **corrección del flujo de credenciales de GitHub**: se eliminan preguntas innecesarias del setup, y `.claude-credentials` ahora tiene prioridad máxima sobre cualquier cuenta del sistema — Claude nunca usa la sesión local de `gh` sin antes validar acceso real al repo.

### Removed
- **Paso de integraciones MCP** (`¿Tu proyecto usa alguna de estas integraciones?`) eliminado del flujo. Notion, Linear, Slack, Sentry y Postgres se configuran dentro de cada proyecto cuando el equipo lo necesita — no tiene sentido pedirlo en el setup inicial sin contexto. Context7 y UI UX Pro Max se manejan ahora con el nuevo paso de herramientas recomendadas.
- **Selección de dominio** (`¿Cuál es el dominio principal?`) eliminada de `stepProjectContext`. La descripción en 1-2 frases del proyecto ya captura ese contexto — preguntar el dominio por separado era redundante y no cambiaba ninguna configuración ni skill.
- **Selección de skills** (`¿Qué skills quieres incluir?`) eliminada como paso interactivo. Ahora se instalan todos los skills automáticamente. El usuario puede explorar y desactivar los que no necesite en el camino, en lugar de tomar esa decisión sin contexto al inicio.
- **`fnm` (Fast Node Manager)** eliminado de la verificación de entorno (Paso 1). Era redundante con `nvm`, que cubre exactamente la misma función.

### Added
- **Paso de herramientas recomendadas** al final del setup (antes del resumen): el CLI detecta Context7 y UI UX Pro Max, explica para qué sirven y pregunta si instalarlos en ese momento. Si el usuario dice que no, le indica que puede hacerlo después con `/tools`.
- **Nuevo skill `/tools`** — lista las herramientas recomendadas, verifica cuáles están instaladas y guía la instalación de las que falten. Úsalo si no las instalaste durante el setup o si quieres verificarlas después.
- **Verificación de UI UX Pro Max en `/design`** — al invocar `/design`, el skill verifica si `uipro` está instalado. Si no, avisa y ofrece el comando para instalarlo antes de continuar.

### Changed
- `stepSkillsSelection` ya no es interactiva — retorna todos los skills disponibles directamente.
- `stepProjectContext` ya no retorna `domain`, solo `projectSummary`.
- `TOOLS_TO_CHECK` en `lib/env-bootstrap.js` ya no incluye `fnm`.
- **Orden de prioridad de credenciales explícito** en `resolve-gh-creds.sh`: (1) `GH_TOKEN` del env, (2) remote URL embebida, (3) `.claude-credentials` — prioridad máxima sobre el sistema, (4) `git credential fill` sin hint de cuenta local, (5) `gh auth token` — último recurso absoluto, solo si tiene acceso real al repo.
- `ensureClaudeCredentialsIgnored()` agrega un comentario explicativo al `.gitignore` en lugar de solo la línea del archivo.
- Regla operativa en `CLAUDE.md.hbs`: Claude siempre hace `source .claude/scripts/resolve-gh-creds.sh` antes de cualquier comando `gh`, incluso fuera de una skill.

### Fixed
- **Commits del setup ahora van en `dev`, no en `main`** — `normalizeRepoBranches` hace `git checkout dev` después de crear la rama, garantizando que todos los commits posteriores del setup (config de Claude, templates de GitHub) queden en `dev`. En el flujo desde cero, el primer commit inicial va en `main` (necesario para poder crear `dev` desde ahí) y el commit de la config de Claude Code se hace en un segundo commit ya en `dev`.
- **`.claude-credentials` ignorado por git en todos los repos** — `ensureClaudeCredentialsIgnored()` se invoca siempre al final del setup de cada repo, independientemente de si hay `projectToken` o no. Antes solo se agregaba a `.gitignore` al guardar credenciales, dejando repos sin token desprotegidos.
- **`gh auth token` (sesión local) ya no se usa sin validar acceso al repo** — ahora verifica con `gh api repos/:o/:r --jq .permissions.push` antes de aceptar la cuenta en `resolveCredsFromRepo` y en `resolve-gh-creds.sh`.
- **`~/.git-credentials` con una sola cuenta se usaba sin validar** — si el store del sistema tenía exactamente una entrada, se tomaba como buena sin verificar acceso al repo. Corregido.
- **Sesión activa de `gh` se filtraba como candidato en `git credential fill`** — el script usaba `gh api user --jq .login` como hint, sesgando hacia la cuenta instalada en la máquina. Eliminado.

### Added
- Nueva función exportada `ensureClaudeCredentialsIgnored(repoPath)` en [lib/github.js](lib/github.js) — garantiza que `.claude-credentials` esté en `.gitignore`, separada de `saveProjectGithubCredentials` para llamarse independientemente durante el setup.

---

## [1.0.7] — 2026-04-24

Versión centrada en **normalización del modelo de branches**: al incorporar un repo al workspace (clone, local o desde cero, en single-repo o multi-repo), el CLI garantiza que el repo tenga `main` (con opción de rename desde `master`) y `dev` como base de trabajo obligatoria. `staging` queda opcional para proyectos con QA previo. Los skills (`/init`, `/apply`, `/build`) refuerzan la regla: cada sesión nueva arranca en `dev`, tanto en single-repo como en todos los repos de un multi-repo.

### Added
- Nueva función `ensureBranchModel` en [lib/github.js](lib/github.js) que normaliza el modelo de branches de un repo. Detecta la branch default (vía `gh api` o `git symbolic-ref`), ofrece rename `master → main` con `gh api -X POST /repos/:o/:r/branches/master/rename`, crea `dev` sí o sí desde la default si no existe, y pregunta opcionalmente por `staging`. Helpers auxiliares: `getDefaultBranch`, `remoteBranchExists`, `renameRemoteBranch`, `createRemoteBranch`.
- Nueva skill [templates/skills/branches.md](templates/skills/branches.md) — `/branches` — que un dev puede invocar en cualquier momento para auditar y reparar el modelo de branches. Útil cuando un repo se incorporó sin correr el normalizador del setup, o cuando el proyecto crece y ahora necesita `staging`.
- Helper `normalizeRepoBranches` en [bin/workspace-template.js](bin/workspace-template.js) que envuelve `ensureBranchModel` con prompts interactivos (`confirm` de `@inquirer/prompts`) y spinners. Se invoca automáticamente en los 4 flujos de clone/setup: single-repo desde URL, single-repo local, single-repo desde cero (post-primer-push), y multi-repo (por cada repo).

### Changed
- [templates/skills/init.md](templates/skills/init.md): nuevo paso `0.5 Posicionarse en dev (obligatorio por sesión)`. Single-repo y multi-repo hacen `git checkout dev` al iniciar. Trabajar en `main` requiere confirmación explícita y no persiste entre sesiones. Si `dev` no existe, se aborta y se invoca `/branches`.
- [templates/skills/apply.md](templates/skills/apply.md): refuerza que las ramas `feat/*`, `fix/*`, `chore/*` se crean **siempre desde `dev`** — nunca desde `main`, `master` o `staging`. Si no existe `dev`, el skill aborta.
- [templates/skills/build.md](templates/skills/build.md): nuevo paso `3.5` que ofrece abrir PR automáticamente hacia `dev` con `gh pr create --base dev` cuando el branch es `feat/*`, `fix/*`, `chore/*` y no existe PR. En multi-repo: un PR por repo, nunca consolidado.
- [templates/rules/branching.md](templates/rules/branching.md): nueva sección `Regla de sesión` al principio documentando que cada `/init` vuelve a `dev`, y sección `Normalización inicial` explicando el comportamiento automático del setup y de `/branches`.

### Notas de migración
- Workspaces ya configurados: correr `npx workspace-template update` propaga la nueva skill `/branches` y los skills actualizados (`init`, `apply`, `build`). La normalización del modelo de branches en repos existentes es **manual**: invocar `/branches` en cada repo. Esto es intencional — `update` no toca el estado Git, solo archivos bajo `.claude/`.

---

## [1.0.6] — 2026-04-23

Versión centrada en **resolución automática de credenciales de GitHub para colaboradores**: cuando un dev clona un repo que ya incorpora el workspace, los skills (`/init`, `/plan`, etc.) detectan automáticamente con qué cuenta tiene acceso al repo y no piden token manualmente. Elimina el bug donde el token equivocado quedaba cacheado permanentemente.

### Added
- Nuevo script [templates/scripts/resolve-gh-creds.sh](templates/scripts/resolve-gh-creds.sh) que los skills invocan con `source`. El script resuelve `GH_TOKEN` y `GITHUB_USER` en este orden, validando contra el repo en cada paso:
  1. `GH_TOKEN` del entorno (si ya es válido para el repo actual).
  2. Credenciales embebidas en `remote.origin.url` (`https://user:token@...`).
  3. `.claude-credentials` cacheado, con revalidación si cambió el remote o pasaron 7 días.
  4. `git credential fill` — funciona con cualquier `credential.helper` (store, osxkeychain, wincred, libsecret) de forma cross-platform.
  5. `gh auth token` de la sesión activa.
- El script copia el token a `.claude-credentials` **solo después de validarlo** contra `GET /repos/:owner/:repo` — elimina el bug donde se cacheaba un token sin acceso. Guarda también `GH_TOKEN_REMOTE` y `GH_TOKEN_VERIFIED_AT` para invalidación inteligente.
- Nueva función `resolveCredsFromRepo` en [lib/github.js](lib/github.js) equivalente en JS, usada por el CLI al reconfigurar un proyecto existente. Lee `~/.git-credentials`, `~/.config/git/credentials`, `.claude-credentials`, `.git/project-credentials`, y `gh auth` — valida cada candidato probando `gh api repos/:owner/:repo`.
- El flujo de `/update` ahora trata `scripts/` como un tipo más junto a `skills/` y `rules/`: detecta nuevos, actualizados, personalizados y obsoletos. Proyectos existentes reciben `resolve-gh-creds.sh` al actualizar, sin intervención manual.
- `saveProjectGithubCredentials` ahora escribe también `GH_TOKEN_REMOTE` y `GH_TOKEN_VERIFIED_AT` para que el script bash no revalide innecesariamente. El archivo se crea con permisos `0600`.

### Changed
- **Credenciales del CLI separadas de las del proyecto**: el archivo que guarda `GH_TOKEN` del CLI se renombró de `.env.local` a [.claude-credentials](./.claude-credentials). Evita mezclar variables del proyecto con credenciales del workspace. Ambos siguen en `.gitignore`.
- Todos los skills (`init`, `plan`, `apply`, `audit`, `build`, `debug`, `deploy`, `review`, `rollback`, `secure`, `sync`, `pentest`, `triage`) ahora usan `source .claude/scripts/resolve-gh-creds.sh || exit 1` en lugar de un bloque bash inline. Un solo lugar para mantener, arreglar y mejorar.
- El flujo single-repo "desde cero" fuerza pedir un token cuando el `owner` ingresado (p.ej. `Dev3ch`) es diferente al usuario autenticado — previene el error `cannot create a repository for <org>` antes de llegar a la llamada.

### Fixed
- Bug reproducible: cuando `~/.git-credentials` tenía múltiples cuentas para `github.com`, git devolvía la primera entrada para cualquier repo y `gh` usaba la sesión global activa. Resultado: `gh issue create` en un repo de `Dev3ch` fallaba con `GraphQL: RenildoChavezFlujolink cannot create a repository for Dev3ch`. Ahora el script valida cada candidato contra el repo específico antes de usarlo.
- Regex de host en el parser de `~/.git-credentials` capturaba el path cuando la entrada tenía formato `https://user:tok@github.com/path` — corregido para capturar solo hasta el primer `/`.
- Los skills ya no cachean silenciosamente un token inválido en `.claude-credentials`. Si la única fuente disponible es una cuenta sin acceso al repo, el script muestra instrucciones accionables en lugar de persistir basura.

---

## [1.0.5] — 2026-04-23

Versión centrada en **detección automática**, **respeto por `.gitignore`** y **manejo robusto de errores de GitHub Project**: el CLI deja de pedir al usuario datos que ya están en el código del repo, deja de mostrar directorios de dependencias/caches en el resumen final, y ya no sigue silenciosamente cuando algo crítico falla.

### Added
- Nuevo módulo [lib/stack-detect.js](lib/stack-detect.js) con dos detectores:
  - `detectStacks(repoPath)` — identifica stacks leyendo `package.json` (next, nuxt, react-native, vue, react), `pyproject.toml`/`requirements.txt`/`Pipfile` (django, fastapi), `manage.py` (django), `go.mod` (go), `pubspec.yaml` (flutter). Devuelve la evidencia por stack.
  - `detectPort(repoPath)` — extrae el puerto local desde `docker-compose*.yml` o variables `PORT=` en `.env*`.
- Nuevo helper `resolveStacks(repoPath, repoName)` en el CLI: si el repo ya tiene código, muestra los stacks detectados con su evidencia y pregunta si aceptarlos o editarlos manualmente. Si no detecta nada, cae al flujo manual.
- Lista `ALWAYS_HIDE_DIRS` en `printGeneratedTree` que oculta siempre `node_modules`, `.venv`, `__pycache__`, `.next`, `dist`, `build`, `target`, `vendor`, `.cache`, `.turbo`, `.dart_tool`, `.expo`, etc. — aunque `.gitignore` sea incompleto o inexistente.
- Nuevo helper `createProjectWithRecovery` en el Paso 5: cuando `gh project create` falla, el CLI muestra un diagnóstico específico del error (permisos insuficientes, scope `project` faltante en el token, owner inválido) y ofrece 5 opciones reales: ingresar número/URL de un Project recién creado manualmente, elegir uno existente, reintentar, continuar sin Project (con advertencia de que skills dependientes fallarán), o cancelar el setup completo.

### Changed
- **Single-repo (github y local)**: ya no se pregunta el stack ni el puerto ciegamente. Se auto-detectan del código existente y solo se pide confirmación o edición.
- **Multi-repo**: cada repo del batch auto-detecta su stack y puerto antes de pedir ajustes al usuario.
- **Scratch (desde cero)**: conserva el flujo manual de `askStacks` — es el único caso donde no hay código que analizar.
- `printGeneratedTree(rootPath, opts)` ahora:
  - Usa `git ls-files --cached --others --exclude-standard` cuando el path es un repo git — respeta automáticamente `.gitignore` sin reimplementar su parser.
  - Tiene fallback con walker manual + lista de dirs siempre ocultos para proyectos sin `.git/`.
  - Acepta `opts.maxDepth` (default 3) para no abrumar con árboles gigantes.
  - Marca directorios con `/` al final.
- Paso 5 (GitHub Project): cuando falla la creación, el CLI muestra instrucciones paso a paso para crear el Project en la UI de GitHub (URL exacta de orgs/users, título sugerido, template recomendado) y pausa para que el usuario lo resuelva sin abandonar el CLI.

### Fixed
- El resumen final ya no muestra `node_modules/`, `.venv/`, `__pycache__/`, archivos `.pyi` de librerías Python instaladas, ni ningún contenido ignorado por `.gitignore`. Solo aparece lo que pertenece al proyecto.
- El setup ya no termina con un "Todo listo" engañoso cuando `gh project create` falló. El resumen solo se muestra si el workspace quedó **realmente completo** o si el usuario eligió explícitamente continuar sin Project.

---

## [1.0.4] — 2026-04-23

Versión centrada en credenciales de GitHub **por proyecto**: permite trabajar con múltiples cuentas de GitHub en la misma máquina sin tocar la configuración global.

### Added

#### Autenticación por proyecto (nuevo flujo en Paso 2)
- Detección automática de `gh` CLI: si no está instalado, se puede configurar el proyecto usando solo un token (validado con `curl` contra la API de GitHub).
- Tres caminos de autenticación según el estado del sistema: usar sesión global de `gh`, ingresar token por proyecto, o ejecutar `gh auth login`.
- Validación de token antes de aceptarlo (llamada real a `/user` de la API de GitHub), con reintento automático en caso de error.
- Extracción automática de credenciales embebidas en URLs (`https://user:token@github.com/owner/repo.git`) — el CLI parsea el user y token y los usa para el proyecto sin pedirlos de nuevo.
- Validación preflight: tokens extraídos de URLs se validan antes de clonar, evitando escribir `.env.local` con credenciales inválidas.

#### Persistencia de credenciales por proyecto
- `saveProjectGithubCredentials()` escribe `GITHUB_USER` y `GH_TOKEN` en `.env.local` del repo, preservando cualquier variable existente (no sobrescribe el archivo).
- `.env.local` se agrega automáticamente a `.gitignore` (o se crea si no existe).
- En multi-repo, las credenciales se guardan en `.env.local` de **cada** repo individual, no solo en la raíz del workspace.
- `git config user.name` local se configura siempre en cada repo, evitando que commits accidentales usen la identidad global del sistema.

#### Resolución de conflictos entre cuentas
- Detección automática cuando un repo local tiene `origin` apuntando a un owner distinto al `ghUser` activo: el CLI avisa del conflicto y ofrece ingresar un token para resolver.
- En multi-repo, un token ingresado mid-batch para resolver un conflicto se propaga al resto de repos del batch.
- `setRepoRemoteWithCreds()` reescribe el remote `origin` en `.git/config` local (no global), embebiendo `user:token@` en la URL HTTPS. Los remotes SSH se dejan intactos.

#### Robustez y UX
- Nueva función `isGitRepo()` detecta si un path es un repositorio git válido. En single-repo ofrece `git init` si no lo es; en multi-repo los salta con aviso.
- Tracker global de directorios creados (`createdResources.dirs`) permite limpieza automática al cancelar el setup con Ctrl+C. Solo se eliminan directorios que este setup creó; los preexistentes nunca se tocan.
- Handler `SIGINT` + catch de `ExitPromptError` + catch de errores inesperados, todos con limpieza de estado parcial antes de salir.
- Enmascaramiento (`maskUrlCreds`) de credenciales en todos los logs, spinners y mensajes de error — el token nunca aparece en la terminal.
- `gh project create`, `gh project view` y `gh project list` aceptan un token opcional y lo usan via `GH_TOKEN` env cuando hay credenciales por proyecto.

#### Documentación
- Nuevo archivo [docs/flujo-autenticacion.md](docs/flujo-autenticacion.md) con 8 secciones y diagramas Mermaid renderizables:
  - Flujo maestro del setup completo.
  - Paso 2 (autenticación) en detalle con todas las ramas.
  - Subdiagrama de validación de token.
  - Single-repo (3 caminos: github/local/scratch).
  - Multi-repo (batch con propagación de token).
  - Persistencia final.
  - Matriz de 15 casos cubiertos con resultados esperados.
  - Manejo de interrupciones y cleanup.

### Changed
- Paso 2 reemplazado completamente: el antiguo flujo que solo verificaba `gh auth status` global ahora ofrece autenticación por proyecto como primera opción.
- `cloneRepo()` acepta un objeto de credenciales opcional y embebe `user:token@` en la URL HTTPS cuando aplica. Los spinners y errores muestran la URL enmascarada.
- Prompt de selección de cuenta global ahora muestra explícitamente las dos opciones (Opción A: sesión global sin `.env.local` — Opción B: token por proyecto con `.env.local`) para que la decisión sea clara.
- Hint de uso del token en el resumen final: reemplazado `grep GH_TOKEN .env.local | cut -d= -f2` por `source .env.local` o `env $(cat .env.local) gh <comando>`.

### Fixed
- `.env.local` preserva comentarios y líneas vacías existentes (antes `filter(Boolean)` las eliminaba).
- Identidad de git en commits: `setGitUserLocal()` ahora se aplica incluso cuando se usa sesión global (no solo con token por proyecto), evitando commits con identidad cruzada.
- En multi-repo, `.env.local` con credenciales se escribe en **cada repo** del workspace, no solo en la raíz (antes si alguien clonaba un repo individual después, no tenía credenciales).

---

## [1.0.3] — 2026-04-23

### Added
- GitHub Project ahora se persiste en `.claude/.workspace-version` bajo el campo `githubProject` (`number`, `owner`, `url`, `title`) al finalizar el setup. Los skills pueden leerlo sin que el usuario lo vuelva a configurar.
- El owner del GitHub Project se guarda **de forma independiente** al owner del repo — soporta Projects de orgs distintas al repo o Projects de usuario.
- `saveGithubProject()` y `readGithubProject()` exportadas desde `lib/updater.js` para leer/escribir la config del Project desde cualquier parte del CLI.

### Changed
- Paso 5 (GitHub Project) ahora pregunta explícitamente el owner del Project con el owner del repo como valor por defecto. Permite vincular repos personales a Projects de orgs y viceversa.
- Skill `/plan` actualizado: lee `githubProject` de `.workspace-version` y vincula cada issue al Project con `gh project item-add` inmediatamente al crearlo. Si el campo no existe, pide el número al dev antes de continuar.

### Fixed
- `update` ahora detecta skills y rules que ya no existen en el template actual y los muestra como `- N obsoleto(s)`. El usuario puede seleccionar cuáles eliminar antes de aplicar. Antes el update solo agregaba y modificaba, nunca limpiaba.

---

## [1.0.2] — 2026-04-23

### Fixed
- Skills generados ahora usan la estructura `<skill>/SKILL.md` con frontmatter YAML requerido por Claude Code (`name`, `description`). Antes se copiaban como archivos planos `<skill>.md` que Claude Code no reconocía como slash commands.

---

## [1.0.1] — 2026-04-23

### Changed
- Single-repo: la pregunta de origen del proyecto (GitHub / local / desde cero) ahora aparece **antes** del nombre y la descripción.
- Flujo local sin remote GitHub: el CLI muestra aviso explícito antes de pedir owner y repo manualmente.
- Pregunta de puerto local cambiada a `Puerto local (ej: 3000, 8000). Enter para omitir:`.

---

## [1.0.0] — 2026-04-23

Primera versión estable. CLI completo para configurar workspaces de Claude Code con ciclo de vida completo: de cero a producción.

### Added

#### CLI principal
- Comando `npx workspace-template` para inicializar un workspace nuevo.
- Comando `npx workspace-template update` para actualizar skills y rules preservando personalizaciones del usuario.
- Comando `npx workspace-template version` y `help`.
- Script `setup.sh` como entrypoint alternativo que verifica Node antes de ejecutar.
- Instalación por `curl | bash` sin necesidad de clonar el repo previamente.

#### Flujo interactivo de configuración (9 pasos)
- Paso 1: verificación de entorno (nvm, node, python, uv, git, gh, docker) con comandos de instalación por SO.
- Paso 2: autenticación GitHub con `gh auth status`, incluyendo guía de scopes y token.
- Paso 3: selección de tipo de proyecto (single-repo / multi-repo).
- Paso 4: configuración de repos con 3 orígenes posibles:
  - Repo ya en GitHub (clona si hace falta).
  - Carpeta local existente (usa tal cual, detecta remote).
  - Empezar desde cero (crea carpeta, clona template del stack, crea repo en GitHub, primer push).
- Paso 5: contexto del proyecto (descripción + dominio).
- Paso 6: selección de skills.
- Paso 7: integraciones MCP opcionales.
- Paso 8: GitHub Project con 4 opciones (usar existente por número/URL, elegir de la lista, crear nuevo, ninguno).
- Paso 9: resumen con árbol de archivos generados.

#### Multi-repo: entrada en batch
- Captura de URLs y rutas mezcladas, una por línea.
- Detección automática de owner/repo desde remote origin.
- Clonado automático de los que aún no están locales.
- Reutiliza repos ya clonados sin fallar.

#### Templates oficiales de stack (Dev3ch)
- Integración con `Dev3ch/react_template` (Next.js, React, React Native).
- Integración con `Dev3ch/django_template`.
- Integración con `Dev3ch/go_template`.
- Integración con `Dev3ch/flutter_template`.
- Soporte para Vue/FastAPI/otros con carpeta vacía + `git init`.

#### Skills — flujo principal (8 comandos, activados por defecto)
- `/init` — orienta al inicio de sesión, lee estado del repo e issues activos.
- `/plan` — crea issues, epics y sub-issues en GitHub.
- `/apply` — implementa el issue activo con estrategia de contexto mínimo para ahorrar tokens.
- `/test` — corre suite completo, reporta cobertura e identifica tests faltantes por stack.
- `/build` — commit + push + comenta progreso en el issue.
- `/review` — code review del PR con perspectiva fresca.
- `/secure` — pre-deploy checklist bloqueante (env vars, secrets en GitHub, CVEs, Dockerfile, CI).
- `/deploy` — genera Dockerfile, GitHub Actions y `.env.example` con diagnóstico inicial del estado del deploy.

#### Skills — soporte (9 comandos, opcionales)
- `/debug` — analiza error/log, clasifica, localiza causa raíz, aplica fix.
- `/audit` — revisión OWASP Top 10 profunda del PR actual.
- `/pentest` — barrida completa de seguridad en 7 fases (secrets en historial, CVEs, endpoints, config, infra, análisis estático, lógica sensible).
- `/sync` — detecta drift entre código real y plan en GitHub, reconcilia issues.
- `/rollback` — revierte último deploy de forma segura con post-mortem.
- `/design` — UI/UX, estilos, componentes, accesibilidad.
- `/triage` — cierra issues cubiertos, mueve estados en bulk.
- `/cross` — coordina cambios cross-repo.
- `/setup` — regenera `CLAUDE.md` y config de un repo individual (refresh).

#### Conexión entre skills
- Cada skill incluye una sección "Siguiente paso" que guía explícitamente al próximo comando según el resultado.
- Flujo estándar documentado en cada `CLAUDE.md` generado.

#### Rules por stack
- `commits.md`, `branching.md`, `tests.md` (base, siempre incluidos).
- `typescript.md` para Next.js, Vue, Nuxt, React Native.
- `python-django.md` para Django.
- `python-fastapi.md` para FastAPI.
- `go.md` para proyectos Go.
- `flutter.md` para proyectos Flutter.

#### Integraciones MCP (7 disponibles)
- Notion (documentación del proyecto).
- Linear (tracking alternativo a GitHub Issues).
- Slack (notificaciones).
- Sentry (monitoreo de errores).
- Postgres (acceso directo a DB en dev/staging).
- Context7 (docs actualizadas de SDKs inyectadas en el prompt).
- n8n (creación de workflows n8n desde Claude).

#### Templates GitHub
- Issue templates: `feature.md`, `bug.md`, `epic.md`.
- `pull_request_template.md`.

#### Sistema de actualizaciones
- Archivo `.claude/.workspace-version` con hashes SHA-256 de cada skill/rule instalado.
- `update` compara hashes y clasifica: nuevo, actualizado upstream, personalizado localmente, sin cambios.
- Personalizaciones del usuario se respetan por defecto.
- Commit automático de las actualizaciones aplicadas.

### Infrastructure
- Publicación inicial en npm como `workspace-template`.
- Paquete distribuye solo `bin/`, `lib/`, `templates/`, `setup.sh` y `README.md`.
- Requiere Node 18+ (recomendado 22 LTS).

[Unreleased]: https://github.com/Dev3ch/workspace_template/compare/v1.1.4...HEAD
[1.1.4]: https://github.com/Dev3ch/workspace_template/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/Dev3ch/workspace_template/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/Dev3ch/workspace_template/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/Dev3ch/workspace_template/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Dev3ch/workspace_template/compare/v1.0.9...v1.1.0
[1.0.9]: https://github.com/Dev3ch/workspace_template/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/Dev3ch/workspace_template/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/Dev3ch/workspace_template/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/Dev3ch/workspace_template/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/Dev3ch/workspace_template/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/Dev3ch/workspace_template/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Dev3ch/workspace_template/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Dev3ch/workspace_template/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Dev3ch/workspace_template/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Dev3ch/workspace_template/releases/tag/v1.0.0
