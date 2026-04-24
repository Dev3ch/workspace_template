# Changelog

Todas las notas de cambios relevantes de `workspace-template` quedan documentadas aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto usa [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

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

[Unreleased]: https://github.com/Dev3ch/workspace_template/compare/v1.0.4...HEAD
[1.0.4]: https://github.com/Dev3ch/workspace_template/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Dev3ch/workspace_template/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Dev3ch/workspace_template/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Dev3ch/workspace_template/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Dev3ch/workspace_template/releases/tag/v1.0.0
