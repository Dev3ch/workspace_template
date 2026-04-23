# Changelog

Todas las notas de cambios relevantes de `workspace-template` quedan documentadas aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto usa [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### Added
- (Nada todavía)

### Changed
- (Nada todavía)

### Fixed
- (Nada todavía)

---

## [1.0.1] — 2026-04-23

### Changed
- Single-repo: la pregunta de origen del proyecto (GitHub / local / desde cero) ahora aparece **antes** del nombre y la descripción, para que el usuario sepa el contexto antes de nombrar el proyecto.
- Flujo local sin remote GitHub: el CLI ahora muestra un aviso explícito (`⚠ No se detectó remote de GitHub — te pediré el owner y repo manualmente`) en lugar de pedir los datos sin previo aviso.
- Pregunta de puerto local cambiada a `Puerto local (ej: 3000, 8000). Enter para omitir:` para dejar claro el formato esperado y que es opcional.

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

[Unreleased]: https://github.com/Dev3ch/workspace_template/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/Dev3ch/workspace_template/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Dev3ch/workspace_template/releases/tag/v1.0.0
