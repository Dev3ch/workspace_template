# Changelog

Todas las notas de cambios relevantes de `workspace-template` quedan documentadas aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto usa [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

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

[Unreleased]: https://github.com/Dev3ch/workspace_template/compare/v1.0.9...HEAD
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
