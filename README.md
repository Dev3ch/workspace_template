# force-template

Configura un workspace de Claude Code para cualquier proyecto — single-repo o multi-repo — con integración completa de GitHub, selección de skills, reglas de trabajo y MCP tools.

## Inicio rápido

```bash
git clone https://github.com/<owner>/force-template
cd force-template
npm install
node bin/force.js
```

O con el script bash:

```bash
./setup.sh
```

## Flujo del CLI

El CLI te guía paso a paso. Todo en español.

```
1. Entorno
   Detecta OS + herramientas: nvm, node, python, uv, git, gh, docker
   Muestra qué falta y el comando exacto para instalarlo según tu OS
   Nunca instala nada automáticamente

2. GitHub auth
   Verifica gh auth status
   Si no estás autenticado: explica scopes, token y formato HTTPS autenticado

3. Tipo de proyecto
   single-repo  →  un solo repositorio
   multi-repo   →  varios repos agrupados en una carpeta workspace

4. Repos
   Single-repo  → ruta local o URL (clona si hace falta)
   Multi-repo   → pega TODAS las URLs / rutas de una vez (una por línea)
                  Detecta owner/repo desde el remote origin
                  Clona los que aún no están locales
                  Luego, por cada repo, pregunta solo: rol, puerto y stack

5. Contexto del proyecto
   Descripción del proyecto (1-2 frases)
   Dominio: ecommerce, SaaS B2B, fintech, CRM, salud, educación, logística, otro

6. Skills
   Elige cuáles incluir de la lista disponible

7. Integraciones MCP (opcional)
   Notion, Linear, Slack, Sentry, Postgres

8. GitHub Project (opcional)
   Usar uno existente  → pega número o URL del project
   Elegir de la lista  → lista tus projects con gh project list
   Crear uno nuevo     → gh project create
   Ninguno             → salta el paso

9. Resumen
   Árbol de todo lo generado + próximos pasos
```

## Multi-repo: entrada en batch

Cuando eliges **multi-repo**, el CLI te deja pegar todos los repos de una vez, mezclando URLs y rutas locales:

```
── Lista de repositorios del workspace ──

Pega las URLs de GitHub o rutas locales de tus repos, una por línea.
Cuando termines, deja una línea vacía y presiona Enter.

  Repo 1: https://github.com/mi-org/api
  Repo 2: https://github.com/mi-org/web
  Repo 3: /home/user/code/mobile
  Repo 4:  (enter vacío → fin)
```

Por cada entrada:

- **URL GitHub** → clona al workspace (si ya existe, lo reutiliza).
- **Ruta local** → usa el repo tal cual y detecta `owner/repo` desde el remote origin.

Después, para cada repo detectado, solo te pregunta lo específico: **rol**, **puerto local** y **stack**.

## GitHub Project: existente o nuevo

El paso 8 te ofrece 4 caminos para enlazar el workspace con un tablero de issues:

| Opción | Qué hace |
|---|---|
| **Usar uno que ya tengo** | Pegas el número (`5`) o URL (`.../projects/5`) y el CLI lo verifica con `gh project view` |
| **Elegir de la lista** | Ejecuta `gh project list --owner <tú>` y te muestra todos los projects para seleccionar |
| **Crear uno nuevo** | Ejecuta `gh project create` con el nombre que le des |
| **Ninguno** | Salta el paso sin hacer nada |

## Qué genera

```
<workspace o repo>/
├── CLAUDE.md                          ← contexto del proyecto (adaptado al tipo y stack)
├── .claude/
│   ├── rules/
│   │   ├── commits.md                 ← conventional commits
│   │   ├── branching.md               ← política 3 branches (main/staging/dev)
│   │   ├── tests.md                   ← reglas de testing
│   │   └── typescript.md              ← reglas de stack (según lo que elegiste)
│   ├── skills/
│   │   └── <solo los skills elegidos>.md
│   └── settings.json                  ← config MCP (si elegiste integraciones)
└── .github/
    ├── ISSUE_TEMPLATE/
    │   ├── feature.md
    │   ├── bug.md
    │   └── epic.md
    └── pull_request_template.md
```

En **multi-repo**, esta estructura se genera tanto en la raíz del workspace como dentro de cada repo (cada repo es autosuficiente con su propio `CLAUDE.md` y `.claude/`).

## Skills disponibles

| Skill | Cuándo usarlo |
|---|---|
| `session-start` | Al inicio de cada sesión: revisa issues activos y estado del repo |
| `progress-tracker` | Al cerrar sesión: commit + push + comenta progreso en el issue |
| `planning` | Para crear issues, epics y sub-issues en GitHub Projects |
| `code-review` | Para revisar PRs con perspectiva fresca |
| `cross-repo` | Cuando un cambio afecta múltiples repos a la vez |
| `triage` | Para cerrar issues cubiertos y mover estados en bulk |
| `security-review` | Revisión de seguridad OWASP de los cambios pendientes |
| `ui-ux` | Diseño UI/UX: estilos, componentes, accesibilidad |
| `repo-setup` | Para configurar un repo individual de forma autónoma |

Para agregar un skill propio después del setup:

1. Crea `.claude/skills/<nombre>.md` en el workspace
2. El archivo debe empezar con `# Skill: <nombre>` y describir cuándo invocarlo y qué pasos seguir
3. Claude Code lo reconoce automáticamente como `/<nombre>`

## Integraciones MCP

MCP (Model Context Protocol) conecta a Claude con herramientas externas directamente desde el editor.

| Integración | Variable de entorno |
|---|---|
| Notion | `NOTION_API_KEY` |
| Linear | `LINEAR_API_KEY` |
| Slack | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` |
| Sentry | `SENTRY_AUTH_TOKEN` |
| Postgres | `DATABASE_URL` |

La configuración queda en `.claude/settings.json` bajo `mcpServers`. Para agregar más integraciones después, edita ese archivo.

## Stacks soportados

| Stack | Regla generada |
|---|---|
| Next.js / React | `typescript.md` |
| Vue / Nuxt | `typescript.md` |
| Django | `python-django.md` |
| FastAPI | `python-fastapi.md` |
| React Native | `typescript.md` |
| Flutter | genérica |
| Otro (texto libre) | genérica |

## GitHub auth

Si no tienes `gh` autenticado, el CLI te explica:

- Scopes necesarios: `repo`, `read:org`, `project`
- Comando: `gh auth login`
- Formato de URL con token para evitar problemas de permisos SSH:
  ```
  https://<usuario>:<token>@github.com/<org>/<repo>.git
  ```

## Dependencias

| Paquete | Uso |
|---|---|
| `@inquirer/prompts` | Prompts interactivos |
| `handlebars` | Templates para CLAUDE.md |
| `chalk` | Colores en terminal |
| `execa` | Ejecución segura de comandos shell |
| `ora` | Spinners de progreso |

## Requisitos del sistema

- Node.js 18 o superior (recomendado: 22 LTS)
- `git` instalado
- `gh` (GitHub CLI) instalado y autenticado

El CLI detecta automáticamente si alguno falta y te muestra cómo instalarlo.
