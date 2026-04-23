# workspace-template

Configura un workspace de Claude Code para cualquier proyecto — single-repo o multi-repo — con integración completa de GitHub, selección de skills, reglas de trabajo y MCP tools.

## Inicio rápido

**Si no tienes Node.js instalado todavía:**

```bash
curl -fsSL https://raw.githubusercontent.com/Dev3ch/workspace_template/main/setup.sh | bash
```

El script verifica tu entorno, instala las dependencias necesarias y lanza el CLI automáticamente.

**Si ya tienes Node.js:**

```bash
npx workspace-template
```

Sin clonar nada, sin pasos previos.

---

**Instalación manual (opcional):**

```bash
git clone https://github.com/Dev3ch/workspace_template
cd workspace_template
npm install
node bin/workspace-template.js
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
   Single-repo  → tres caminos:
                  · Ya tengo repo en GitHub  → clona (o reutiliza si ya existe local)
                  · Ya tengo carpeta local   → usa tal cual, detecta remote si existe
                  · Empiezo desde cero       → crea carpeta, clona template del stack,
                                               crea repo en GitHub y hace primer push
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

## Actualizar un workspace existente

Cuando salga una nueva versión de `workspace-template` con skills nuevos o mejoras, puedes traer los cambios sin perder tu configuración personalizada:

```bash
# Desde la raíz del workspace
npx workspace-template update

# O especificando un path
npx workspace-template update /ruta/al/workspace
```

Qué hace:

1. Lee la versión instalada desde `.claude/.workspace-version`.
2. Compara hash por hash tus skills y rules contra los del paquete más reciente.
3. Clasifica los cambios:
   - **`+` nuevo** — skills que no tenías (aparece checkeado por defecto)
   - **`~` actualizado** — cambió upstream sin que tú lo modificaras (checkeado)
   - **`!` personalizado** — tú lo modificaste localmente (NO checkeado — confirma antes de sobrescribir)
4. Te deja elegir qué aplicar con checkboxes.
5. Commitea los cambios en tu repo con un mensaje estándar.

Tus personalizaciones siempre se respetan salvo que las selecciones manualmente.

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
│   │   └── <skill>/
│   │       └── SKILL.md               ← formato requerido por Claude Code
│   └── settings.json                  ← config MCP (si elegiste integraciones)
└── .github/
    ├── ISSUE_TEMPLATE/
    │   ├── feature.md
    │   ├── bug.md
    │   └── epic.md
    └── pull_request_template.md
```

En **multi-repo**, esta estructura se genera tanto en la raíz del workspace como dentro de cada repo (cada repo es autosuficiente con su propio `CLAUDE.md` y `.claude/`).

## Comandos disponibles

Todos los comandos son skills de Claude Code invocables con `/comando`.

### Flujo principal

| Comando | Qué hace |
|---|---|
| `/init` | Orienta: lee estado del repo, issues activos y rama actual |
| `/plan` | Planifica: crea issues, epics y sub-issues en GitHub |
| `/apply` | Ejecuta: toma el issue activo, implementa el código y corre tests |
| `/test` | Verifica: corre el suite completo, reporta cobertura e identifica huecos |
| `/build` | Guarda: commit + push + comenta progreso en el issue |
| `/review` | Revisa: code review del PR con perspectiva fresca |
| `/secure` | Valida: pre-deploy checklist (env vars, secrets, deps, Dockerfile) |
| `/deploy` | Publica: genera Dockerfile, GitHub Actions y `.env.example` |

```
/init → /plan → /apply → /test → /build → /review → /secure → /deploy
                   ↑                          ↑
                /debug                      /sync
           (si algo falla)           (si el plan derivó)
```

### Comandos de soporte

| Comando | Qué hace |
|---|---|
| `/debug` | Analiza un error o log, identifica la causa raíz y aplica el fix |
| `/audit` | Revisión de seguridad profunda del código (OWASP Top 10, auth, lógica sensible) |
| `/pentest` | Barrida completa de seguridad sobre todo el proyecto (secrets, CVEs, endpoints, infra) |
| `/sync` | Detecta drift entre el código real y el plan en GitHub, reconcilia issues |
| `/rollback` | Revierte el último deploy de forma segura y crea issue de post-mortem |
| `/design` | UI/UX: estilos, componentes, paletas, accesibilidad |
| `/triage` | Limpieza: cierra issues cubiertos y mueve estados en bulk |
| `/cross` | Multi-repo: coordina cambios que afectan varios repos a la vez |
| `/setup` | Refresh: regenera `CLAUDE.md` y config de un repo individual |

### Agregar un comando propio

1. Crea la carpeta `.claude/skills/<nombre>/` en el workspace
2. Dentro crea `SKILL.md` con este encabezado:
   ```markdown
   ---
   name: <nombre>
   description: Qué hace y cuándo invocarlo
   ---

   # /<nombre>
   ...instrucciones...
   ```
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
| Context7 | — (sin credenciales, inyecta docs de SDKs actualizadas) |
| n8n | `N8N_API_KEY`, `N8N_BASE_URL` |

La configuración queda en `.claude/settings.json` bajo `mcpServers`. Para agregar más integraciones después, edita ese archivo.

## Stacks soportados

| Stack | Regla generada | Template oficial |
|---|---|---|
| Next.js / React | `typescript.md` | [Dev3ch/react_template](https://github.com/Dev3ch/react_template) |
| Vue / Nuxt | `typescript.md` | — |
| Django | `python-django.md` | [Dev3ch/django_template](https://github.com/Dev3ch/django_template) |
| FastAPI | `python-fastapi.md` | — |
| React Native | `typescript.md` | [Dev3ch/react_template](https://github.com/Dev3ch/react_template) |
| Flutter | `flutter.md` | [Dev3ch/flutter_template](https://github.com/Dev3ch/flutter_template) |
| Go | `go.md` | [Dev3ch/go_template](https://github.com/Dev3ch/go_template) |
| Otro (texto libre) | genérica | — |

Cuando eliges **"Empiezo desde cero"**, el CLI clona automáticamente el template oficial del stack seleccionado, desconecta el remote original y crea un nuevo repo en GitHub a tu nombre.

## Herramientas opcionales recomendadas

Estas herramientas no son instaladas por el CLI pero potencian el workflow con Claude Code:

### MCPs adicionales

| MCP | Para qué | Configuración |
|---|---|---|
| `n8n-mcp` | Crear y gestionar workflows N8N desde Claude Code | `.mcp.json` |
| `context7` | Docs actualizadas de SDKs inyectadas en el prompt | `npx ctx7 setup` |

### Librerías globales

| Librería | Para qué | Instalación |
|---|---|---|
| `@playwright/cli` | Automatización de navegador (formularios, portales, dashboards) | `npm install -g @playwright/cli@latest` |
| `@railway/cli` | Deploy a Railway desde terminal | `npm install -g @railway/cli` |
| `flyctl` | Deploy a Fly.io desde terminal | `curl -L https://fly.io/install.sh \| sh` |

### Skills de la comunidad

| Skill | Para qué | Fuente |
|---|---|---|
| `ui-ux-pro-max` | 50+ estilos, 161 paletas, 57 font pairings para UI/UX | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) |

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

## Historial de cambios

Ver [CHANGELOG.md](CHANGELOG.md) para el detalle de cada versión.
