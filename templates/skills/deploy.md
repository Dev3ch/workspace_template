---
name: deploy
description: Configura o verifica el pipeline de deploy. Cuando hace falta trabajo (setup nuevo, migración a CI/CD), crea un work-item padre con tasks (sub-issues) por cada componente. Usar después de /secure.
---

# /deploy

Prepara el proyecto para deployment: detecta el estado actual y, según el caso, verifica salud o configura desde cero (Dockerfile, GitHub Actions, `.env.example`). Cuando hay trabajo accionable, **crea un work-item padre tipo `chore`** con label `deploy` y **una task (sub-issue nativo) por cada componente** — siguiendo el patrón de `/pentest`, `/audit` y `/secure`.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

- Cuando el proyecto va a producción por primera vez.
- Cuando necesitas configurar el pipeline de CI/CD desde cero.
- Cuando quieres verificar que producción ya configurada sigue sana.
- Cuando vas a agregar un entorno nuevo (staging, preview).

**Requisito previo:** `/secure` debe haber pasado sin bloqueantes. Si no lo has corrido, este skill lo ejecuta primero.

## Modelo de trabajo

Cuando hay trabajo accionable (Caso B y C abajo), se crea estructura work-item + sub-issues:

```
Work-item padre  ([DEPLOY] chore)             ← issue padre
  ├─ Task (sub-issue nativo)  ← Generar Dockerfile        → label component-docker
  ├─ Task (sub-issue nativo)  ← Crear workflow CI/CD      → label component-workflow
  ├─ Task (sub-issue nativo)  ← Configurar secrets        → label component-secrets
  ├─ Task (sub-issue nativo)  ← Generar .env.example      → label component-env
  └─ Task (sub-issue nativo)  ← Primer deploy de prueba   → label component-firstdeploy
```

Reglas:
- **Cada componente accionable es una task** (sub-issue nativo del padre vía `addSubIssue`).
- Los **labels describen el componente y el proveedor**, no narrativa libre.
- El **body de la task** explica qué hay que generar/configurar y los criterios de aceptación.
- **Caso A (producción ya sana)** → no se crea work-item; se reporta ✓ y termina.
- **Caso B (migración a CI/CD)** → solo tasks de los componentes que faltan (no Dockerfile si ya existe).
- **Caso C (setup completo)** → todas las tasks aplicables al stack/proveedor.
- Tanto el padre como cada task se agregan al **GitHub Project** del workspace.

Componentes posibles (label secundario):
- `component-docker` — Dockerfile
- `component-workflow` — `.github/workflows/deploy.yml`
- `component-env` — `.env.example`
- `component-secrets` — secrets en GitHub
- `component-gitignore` — actualizar `.gitignore`
- `component-firstdeploy` — primer deploy de prueba
- `component-newenv` — nuevo entorno (staging, preview)
- `component-rotate` — rotar secrets / actualizar variables

## Pasos

### 0. Detectar el estado real del deploy ANTES de preguntar nada

**Regla principal:** `/deploy` no debe sugerir "vamos a configurar producción" si producción **ya existe**. Antes de cualquier prompt, ejecutar la auto-detección y mostrarle al dev lo que encontró.

```bash
# ── Configs de proveedores en el repo ──
PROVIDER_CONFIGS=()
[ -f vercel.json ]    && PROVIDER_CONFIGS+=("vercel.json (Vercel)")
[ -f fly.toml ]       && PROVIDER_CONFIGS+=("fly.toml (Fly.io)")
[ -f railway.json ]   && PROVIDER_CONFIGS+=("railway.json (Railway)")
[ -f render.yaml ]    && PROVIDER_CONFIGS+=("render.yaml (Render)")
[ -f netlify.toml ]   && PROVIDER_CONFIGS+=("netlify.toml (Netlify)")
[ -f .vercel/project.json ] && PROVIDER_CONFIGS+=(".vercel/project.json (Vercel CLI linked)")
[ -f firebase.json ]  && PROVIDER_CONFIGS+=("firebase.json (Firebase)")
[ -f app.yaml ]       && PROVIDER_CONFIGS+=("app.yaml (App Engine)")
[ -f Dockerfile ]     && PROVIDER_CONFIGS+=("Dockerfile")
[ -f docker-compose.yml ] || [ -f compose.yml ] && PROVIDER_CONFIGS+=("docker-compose")

# ── Workflows de CI/CD activos ──
DEPLOY_WORKFLOWS=()
for wf in .github/workflows/*.yml .github/workflows/*.yaml; do
  [ -f "$wf" ] || continue
  if grep -qiE "deploy|vercel|fly|railway|render|netlify|firebase|gcloud|aws-actions" "$wf"; then
    DEPLOY_WORKFLOWS+=("$wf")
  fi
done

# ── Runs recientes (¿el pipeline corrió últimamente?) ──
RECENT_RUNS=$(gh run list --limit 5 --json name,status,conclusion,createdAt,event 2>/dev/null || echo "[]")

# ── Releases / tags ──
RELEASES=$(gh release list --limit 3 2>/dev/null || true)
TAGS=$(git tag --sort=-creatordate | head -3)

# ── Vercel: ¿el repo está linkeado a un proyecto? ──
VERCEL_LINKED="no"
[ -f .vercel/project.json ] && VERCEL_LINKED="yes (.vercel/project.json presente)"
if command -v vercel >/dev/null 2>&1; then
  vercel project ls 2>/dev/null | head -10 && VERCEL_LINKED="yes (vercel CLI auth ok)"
fi

# ── Fly.io: ¿hay app creada? ──
FLY_APP=""
if [ -f fly.toml ]; then
  FLY_APP=$(grep "^app " fly.toml | awk '{print $3}' | tr -d '"')
fi

# ── Secrets ya configurados en GitHub ──
EXISTING_SECRETS=$(gh secret list --json name --jq '.[].name' 2>/dev/null | tr '\n' ' ')

# ── Branches protegidas ──
PROTECTED=$(gh api "repos/{owner}/{repo}/branches" --jq '.[] | select(.protected==true) | .name' 2>/dev/null | tr '\n' ' ')
```

Mostrar el resumen al dev:

```
=== Diagnóstico de deploy ===

Configs de proveedor detectados:
  ✓ vercel.json
  ✓ .vercel/project.json (proyecto linkeado a Vercel)

Workflows de CI/CD:
  ✓ .github/workflows/deploy.yml — última run: success (hace 2 días)

Releases recientes:
  v1.4.0  (hace 2 días)
  v1.3.0  (hace 1 semana)

Branches protegidas: main, staging, dev

Secrets configurados:
  VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID

Tu proyecto YA está en producción con Vercel + GitHub Actions.
```

### 0.5. Decidir el camino según el diagnóstico

```
┌─────────────────────────────────────────────────────────────┐
│ Estado detectado          → Camino                           │
├─────────────────────────────────────────────────────────────┤
│ A. Ya en producción       → revisar salud, NO crear issues   │
│    + CI/CD activo                                            │
│                                                              │
│ B. Configs presentes      → work-item con tasks de los       │
│    pero sin workflow         componentes que faltan          │
│                                                              │
│ C. Nada detectado         → work-item con todas las tasks    │
│                                                              │
│ D. Diagnóstico ambiguo    → preguntar al dev                 │
└─────────────────────────────────────────────────────────────┘
```

**Caso A — Ya está en producción:**

```
Tu proyecto YA está desplegado y el CI/CD corre solo.
No tiene sentido reconfigurar. ¿Qué necesitas?

  1. Verificar que el último deploy esté sano (logs, métricas)
  2. Hacer un deploy manual ahora (ej: hotfix urgente)
  3. Cambiar de proveedor o añadir un nuevo entorno (staging, preview)
  4. Rotar secrets / actualizar variables de entorno
  5. Solo quería confirmar, todo bien — salir
```

Acciones por opción:

- **1**: `gh run list --workflow=deploy.yml --limit 5` + `gh run view <id> --log`. Si pasó y healthchecks responden → reportar ✓ y salir. **No crear issues.**
- **2**: ejecutar deploy manual del proveedor. Confirmar antes. **No crear issues.**
- **3**: ir al paso 9 con foco en el nuevo entorno. **Crea work-item con label `component-newenv`.** No tocar configuración existente.
- **4**: ir al paso 9 con label `component-rotate`. Solo tasks para rotar/actualizar secrets concretos.
- **5**: terminar con `✓ Producción saludable, nada que reconfigurar.`

**Caso B — Configs presentes pero sin CI/CD:**

```
Detecté configs de Vercel/Fly/etc, pero no hay workflow de GitHub Actions.
Probablemente despliegas manual desde tu máquina.

¿Quieres migrar a deploy automático por push a main?
```

Si confirma → ir al paso 9 con tasks solo para componentes faltantes (típicamente: workflow + secrets + first auto-deploy). **No tocar Dockerfile ni configs ya existentes.**

**Caso C — Nada detectado, primer deploy:**

Continuar con el flujo completo (pasos 1-9, todas las tasks aplicables).

**Caso D — Ambiguo:**

```
Detecté esto:
  ✓ Dockerfile presente
  ✗ Sin workflows
  ✗ Sin configs de proveedor
  ✓ Mencionas "deploy" en README

¿En qué estado real está?

  1. Ya hay producción manual (ej: VPS), quiero migrar a CI/CD
  2. Nunca se desplegó, hagamos el setup completo
  3. Otro — explicar
```

**Regla principal:** si producción ya existe y está sana, **el output esperado de `/deploy` es no hacer nada**, salir con un check ✓ y **no crear ningún work-item**. Re-generar archivos que ya están en uso es destructivo.

### 0.7. Ejecutar /secure si no se ha corrido

```bash
# Si no hay evidencia reciente de /secure, ejecutarlo ahora
# El deploy NO continúa si /secure encuentra bloqueantes
```

### 1. Detectar stack y estado del repo

```bash
cat CLAUDE.md
ls -la
cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat go.mod 2>/dev/null || cat pubspec.yaml 2>/dev/null
git status
git log --oneline -5
```

### 2. Preguntar al dev el proveedor objetivo (si Caso B/C)

```
¿Ya tienes proveedor de deploy?

  1. Sí, ya tengo uno              → dime cuál
  2. No, quiero recomendación      → ver tabla según stack
  3. Quiero auto-hospedar (VPS)    → setup con Docker + Nginx
```

**Tabla de recomendación por stack (si elige opción 2):**

| Stack | Recomendado | Alternativas | Cuándo elegirlo |
|---|---|---|---|
| Next.js / React | **Vercel** | Railway, Fly.io, Netlify | SSR fácil, preview por PR, plan free generoso |
| Django / FastAPI | **Railway** | Fly.io, Render, Cloud Run | DB Postgres incluida, deploy por git push |
| Go | **Fly.io** | Railway, Cloud Run | Binario compacto, edge deploy global |
| Flutter (web) | **Firebase Hosting** | Vercel, Netlify | Hosting estático + Firebase stack |
| Flutter (móvil) | **Play Store / App Store** | Firebase App Distribution (beta) | Distribución oficial |
| Cualquiera con DB | **Railway + Fly.io** | Render | DB gestionada + app separadas |

**Criterios de decisión:**
- **¿Presupuesto $0?** → Vercel (Next.js), Fly.io free tier
- **¿Necesitas DB gestionada?** → Railway, Render
- **¿Tráfico global?** → Fly.io, Cloud Run
- **¿Compliance estricto?** → VPS propio o AWS/GCP

### 3. Consultar docs actualizadas del proveedor (si context7 está disponible)

```bash
# Si context7 está configurado en .mcp.json, usarlo para obtener
# la documentación más reciente del proveedor antes de generar configs.
```

### 4. Plantillas de Dockerfile (referencia para la task de docker)

**Next.js / React:**
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

**Django:**
```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN pip install uv
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev
COPY . .
RUN python manage.py collectstatic --noinput
EXPOSE 8000
CMD ["uv", "run", "gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
```

**FastAPI:**
```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN pip install uv
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev
COPY . .
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Go:**
```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server ./cmd/server

FROM scratch
COPY --from=builder /app/server /server
EXPOSE 8080
CMD ["/server"]
```

### 5. Plantillas de GitHub Action (referencia para la task de workflow)

**Vercel (Next.js):**
```yaml
name: Deploy to Vercel
on:
  push:
    branches: [main]
  pull_request:
    branches: [main, staging, dev]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: ${{ github.ref == 'refs/heads/main' && '--prod' || '' }}
```

**Railway (Django / FastAPI / Go):**
```yaml
name: Deploy to Railway
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        run: npx @railway/cli@latest up --service ${{ secrets.RAILWAY_SERVICE_ID }}
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

**Fly.io (cualquier stack con Docker):**
```yaml
name: Deploy to Fly.io
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### 6. Plantilla de `.env.example` (referencia para la task de env)

```bash
# Buscar referencias a variables de entorno usadas
grep -rn "process\.env\.\|os\.environ\|os\.getenv\|viper\.Get" \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.go" \
  --exclude-dir=node_modules --exclude-dir=.git \
  . | grep -oP '(?<=process\.env\.)[A-Z_]+|(?<=os\.environ\[.)[A-Z_]+|(?<=getenv\(")[A-Z_]+' \
  | sort -u
```

```
# App
NODE_ENV=production
PORT=3000

# Base de datos
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Auth
JWT_SECRET=
NEXTAUTH_SECRET=
NEXTAUTH_URL=https://tu-dominio.com

# Proveedor de deploy
# VERCEL_TOKEN=
# RAILWAY_TOKEN=
# FLY_API_TOKEN=
```

### 7. Listar componentes faltantes y proponer las tasks al dev

Antes de crear nada en GitHub, mostrar al dev el plan:

```
=== /deploy — Plan de configuración ===
Stack:     Next.js
Proveedor: Vercel
Caso:      C (setup completo desde cero)

Voy a crear este work-item:

  Padre: [DEPLOY] Setup pipeline Vercel para Next.js

  Tasks:
    1. component-docker         Generar Dockerfile (multistage)
    2. component-workflow       Crear .github/workflows/deploy.yml
    3. component-env            Generar .env.example desde scan del código
    4. component-secrets        Configurar VERCEL_TOKEN, ORG_ID, PROJECT_ID en GitHub
    5. component-gitignore      Asegurar .env y .vercel en .gitignore
    6. component-firstdeploy    Primer deploy de prueba a preview

¿Confirmas que cree el work-item y sus tasks? (s/n)
```

Esperar confirmación. Si dice no → terminar sin crear nada.

## Crear el work-item en GitHub (con sub-issues nativos)

### 8. Asegurar que existen los labels

```bash
for label in deploy chore severity-high \
             component-docker component-workflow component-env \
             component-secrets component-gitignore component-firstdeploy \
             component-newenv component-rotate; do
  gh label create "$label" --color BFD4F2 --description "Deploy tagging" 2>/dev/null || true
done
```

Colores recomendados (no bloquea si fallan):
- `deploy` → `0E8A16`
- `chore` → `5319E7`
- componentes → `BFD4F2`

### 9. Crear el work-item padre (chore + deploy)

```bash
BRANCH=$(git branch --show-current)
STACK="Next.js"     # detectado en paso 1
PROVIDER="Vercel"   # elegido en paso 2
CASE="C"            # A | B | C | D

PARENT_TITLE="[DEPLOY] Setup pipeline ${PROVIDER} para ${STACK}"

PARENT_URL=$(gh issue create \
  --title "$PARENT_TITLE" \
  --label "chore,deploy" \
  --body "$(cat <<EOF
## Objetivo

Configurar el pipeline de deploy a ${PROVIDER} para este proyecto ${STACK} — work-item padre que agrupa cada componente como task (sub-issue nativo).

## Contexto

- Stack: ${STACK}
- Proveedor: ${PROVIDER}
- Caso de diagnóstico: ${CASE}
- Rama de trabajo: \`${BRANCH}\`

## Tasks

<!-- Se llena con los #N reales después de crear los sub-issues -->
- [ ] #TBD

## Criterios de aceptación

- [ ] Todos los componentes generados/configurados.
- [ ] Primer deploy de prueba pasa sin errores.
- [ ] \`gh run list --workflow=deploy.yml\` muestra success.
- [ ] Healthcheck del entorno responde correctamente.
- [ ] \`/secure\` re-corrido pasa sin bloqueantes.

## Reporte completo

Generado durante \`/deploy\`.
EOF
)")

PARENT_N=$(gh issue view "$PARENT_URL" --json number --jq .number)
PARENT_NODE_ID=$(gh issue view "$PARENT_N" --json id --jq .id)
```

### 10. Crear una task por componente y vincularla como sub-issue nativo

Para **cada componente faltante**:

```bash
COMPONENT="docker"     # docker | workflow | env | secrets | gitignore | firstdeploy | newenv | rotate
TITLE="Generar Dockerfile multistage para Next.js"
ACCEPTANCE="Build local pasa con \`docker build .\`; imagen final < 200MB; corre como usuario no-root."

TASK_URL=$(gh issue create \
  --title "[DEPLOY] ${COMPONENT}: ${TITLE}" \
  --label "task,deploy,component-${COMPONENT}" \
  --body "$(cat <<EOF
## Componente

**Tipo:** \`component-${COMPONENT}\`
**Proveedor:** ${PROVIDER}
**Stack:** ${STACK}

## Qué hay que hacer

${TITLE}

<!-- Detalle: qué archivo se crea/modifica, qué config va dentro, ver plantilla en /deploy paso ${PASO} -->

## Subtareas

- [ ] Generar / modificar el archivo
- [ ] Verificar localmente (build, lint, dry-run según aplique)
- [ ] Commitear con Conventional Commits

## Criterios de aceptación

${ACCEPTANCE}

## Tipo de cambio (Conventional Commits)

chore | ci | build

## Esfuerzo estimado

S | M | L

## Work-item padre

#${PARENT_N}
EOF
)")

TASK_N=$(gh issue view "$TASK_URL" --json number --jq .number)
TASK_NODE_ID=$(gh issue view "$TASK_N" --json id --jq .id)

# Vincular como sub-issue NATIVO del padre
gh api graphql -f query='
mutation($parent: ID!, $child: ID!) {
  addSubIssue(input: { issueId: $parent, subIssueId: $child }) {
    subIssue { number }
  }
}' -f parent="$PARENT_NODE_ID" -f child="$TASK_NODE_ID"
```

Repetir para cada componente listado en el paso 7. **No olvidar la mutación `addSubIssue`** — sin eso, los issues quedan sueltos.

**Plantillas de tasks recomendadas por componente:**

| Componente | Título | Criterios de aceptación |
|---|---|---|
| `docker` | Generar Dockerfile multistage para `<stack>` | `docker build .` pasa; imagen < 200MB; USER no-root |
| `workflow` | Crear `.github/workflows/deploy.yml` para `<provider>` | `gh workflow run` simulado pasa; depende de job `test` |
| `env` | Generar `.env.example` desde scan del código | Todas las vars usadas declaradas; sin valores reales |
| `secrets` | Configurar secrets `<X, Y, Z>` en GitHub | `gh secret list` muestra todos los nombres requeridos |
| `gitignore` | Asegurar `.env` y configs locales en `.gitignore` | `git check-ignore .env` retorna 0 |
| `firstdeploy` | Primer deploy de prueba a preview/staging | URL responde 200; logs sin errores; healthcheck OK |
| `newenv` | Configurar nuevo entorno `<staging\|preview>` | Entorno levantado; secrets aislados; promoción manual configurada |
| `rotate` | Rotar secret `<NOMBRE>` | Secret nuevo activo; deploy con secret nuevo pasa; secret viejo revocado en el proveedor |

### 11. Agregar work-item + tasks al GitHub Project

```bash
PROJECT_NUMBER=$(jq -r '.githubProject.number' .claude/.workspace-version)
PROJECT_OWNER=$(jq -r '.githubProject.owner' .claude/.workspace-version)

gh project item-add "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --url "$PARENT_URL"

for TASK_URL in "${TASK_URLS[@]}"; do
  gh project item-add "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --url "$TASK_URL"
done
```

Si falla, reportar al dev y pedir hacerlo manual.

### 12. Actualizar el body del padre con los #N reales

```bash
gh issue edit "$PARENT_N" --body "$(actualizar el body con la lista real)"
```

### 13. Crear rama del work-item y delegar a /apply

```bash
# La rama del work-item sigue el patrón estándar
git checkout dev
git pull origin dev
git checkout -b "chore/${PARENT_N}-deploy-${PROVIDER,,}"
```

A partir de aquí, el dev puede correr `/apply` sobre cada task del work-item siguiendo el flujo normal (una task = un commit, un solo PR al cerrar todas).

## Output esperado

**Caso A (producción ya sana — sin work-item):**

```
=== /deploy — Diagnóstico ===
Stack:        Next.js
Proveedor:    Vercel (linkeado vía .vercel/project.json)
CI/CD:        .github/workflows/deploy.yml (última run: success)
Último deploy: v1.4.0, hace 2 días, healthcheck OK

✓ Producción saludable, nada que reconfigurar.
(No se crea work-item.)
```

**Caso C (setup completo — con work-item):**

```
=== /deploy — Setup completo ===
Stack:     Next.js
Proveedor: Vercel
Rama:      chore/170-deploy-vercel

GitHub:
  Work-item padre: [DEPLOY] #170 — Setup pipeline Vercel para Next.js
  Sub-issues nativos creados: 6
    component-docker:       #171
    component-workflow:     #172
    component-env:          #173
    component-secrets:      #174
    component-gitignore:    #175
    component-firstdeploy:  #176

  Project: agregados 7 items (1 padre + 6 tasks)

Próximo paso: /apply sobre #171 (component-docker).
```

**Caso B (migración a CI/CD — work-item parcial):**

```
=== /deploy — Migración a CI/CD ===
Stack:           Next.js
Proveedor:       Vercel (ya linkeado, configs presentes)
Faltan:          workflow, secrets, primer auto-deploy
Rama:            chore/172-deploy-vercel-cicd

GitHub:
  Work-item padre: [DEPLOY] #172 — Migración a CI/CD para Vercel
  Sub-issues nativos creados: 3
    component-workflow:     #173
    component-secrets:      #174
    component-firstdeploy:  #175

  Project: agregados 4 items (1 padre + 3 tasks)

Próximo paso: /apply sobre #173 (component-workflow).
```

## Siguiente paso

- **Tasks creadas** → `/apply` sobre cada sub-issue. Una task = un commit. Cuando todas las tasks cierran → `/build` abre PR único hacia `dev`.
- **Caso A (todo bien)** → monitorear métricas; nada que hacer.
- **Deploy rompió producción** → `/rollback` inmediato.
- **Error en el pipeline de CI** → `/debug` con los logs del workflow.

## Notas

- **Si producción ya existe y está sana, el output correcto es "no hacer nada" y NO crear work-item.** Re-generar archivos que ya están en uso desconfigura el sistema.
- Siempre generar el workflow con los 3 branches protegidos (main/staging/dev).
- En PRs, hacer deploy a un entorno de preview si el proveedor lo soporta (Vercel, Railway).
- Nunca commitear `.env` — solo `.env.example`.
- **Cada componente accionable abre una task** — no se crea un solo issue plano con checklist.
- Para Flutter móvil, el deploy requiere pasos adicionales (signing, App Store Connect, Play Store) — abrir un work-item específico para ese flujo.
- **Detección de Vercel sin token:** la presencia de `.vercel/project.json` es señal **fuerte** de que el repo ya está linkeado.
- **Detección de Fly.io sin token:** `fly.toml` con `app = "..."` definido = ya hay app creada.
