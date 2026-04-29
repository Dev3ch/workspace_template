---
name: deploy
description: Genera Dockerfile, GitHub Actions y .env.example. Usar después de /secure.
---

# /deploy

Prepara el proyecto para deployment: genera Dockerfile, GitHub Actions de CI/CD y `.env.example` según el stack y proveedor elegido.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

Cuando el proyecto está listo para salir a producción por primera vez, o cuando necesitas configurar el pipeline de CI/CD desde cero.

**Requisito previo:** `/secure` debe haber pasado sin bloqueantes. Si no lo has corrido, este skill lo ejecuta primero.

## Pasos

### 0. Diagnóstico inicial

Antes de generar nada, preguntar al dev:

```
¿En qué estado está tu deploy?

  1. Nunca se ha desplegado          → setup completo (pasos 1-11)
  2. Ya está desplegado con CI/CD    → solo revisar/actualizar (paso 11)
  3. Ya está desplegado manualmente  → migrar a CI/CD (pasos 5-11)
  4. No sé si está desplegado        → hacer diagnóstico
```

**Si elige "No sé", ejecutar diagnóstico:**

```bash
# ¿Hay workflow de deploy?
ls .github/workflows/*.yml 2>/dev/null

# ¿Hay Dockerfile?
ls Dockerfile docker-compose.yml 2>/dev/null

# ¿Hay configs de proveedores?
ls vercel.json fly.toml railway.json render.yaml netlify.toml 2>/dev/null

# ¿El remote tiene releases/deploys recientes?
gh run list --limit 5 --json name,status,conclusion,createdAt 2>/dev/null
```

Presentar el diagnóstico al dev y confirmar qué camino tomar.

### 0.5. Ejecutar /secure si no se ha corrido

```bash
# Si no hay evidencia reciente de /secure, ejecutarlo ahora
# El deploy NO continúa si /secure encuentra bloqueantes
```

### 1. Detectar stack y estado del repo

```bash
# Leer CLAUDE.md para conocer el stack
cat CLAUDE.md

# Verificar archivos clave del stack
ls -la
cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat go.mod 2>/dev/null || cat pubspec.yaml 2>/dev/null

# Estado actual
git status
git log --oneline -5
```

### 2. Preguntar al dev el proveedor objetivo

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
# Ejemplo: "dame la guía de deploy de Fly.io para una app Django con Postgres"
```

### 4. Generar Dockerfile (si aplica)

Según el stack, generar un `Dockerfile` optimizado para producción:

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

### 5. Generar GitHub Action de CI/CD

Crear `.github/workflows/deploy.yml` según el proveedor:

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

**CI genérico (tests + build, sin deploy):**
```yaml
name: CI
on:
  push:
    branches: [main, staging, dev]
  pull_request:
    branches: [main, staging, dev]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup y test
        run: |
          # Ajustar según el stack
          npm ci && npm test      # Node
          # uv sync && uv run pytest  # Python
          # go test ./...             # Go
```

### 6. Generar `.env.example`

Escanear el proyecto para detectar variables de entorno usadas y generar `.env.example`:

```bash
# Buscar referencias a process.env, os.environ, os.getenv, etc.
grep -rn "process\.env\.\|os\.environ\|os\.getenv\|viper\.Get" \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.go" \
  --exclude-dir=node_modules --exclude-dir=.git \
  . | grep -oP '(?<=process\.env\.)[A-Z_]+|(?<=os\.environ\[.)[A-Z_]+|(?<=getenv\(")[A-Z_]+' \
  | sort -u
```

Generar el archivo con las vars detectadas + las del proveedor:

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

# Proveedor de deploy (completar según el que uses)
# VERCEL_TOKEN=
# RAILWAY_TOKEN=
# FLY_API_TOKEN=
```

### 7. Verificar secrets en GitHub

```bash
# Listar secrets actuales del repo
gh secret list

# Agregar un secret
gh secret set NOMBRE_SECRET
```

Confirmar que los secrets requeridos por el workflow generado estén configurados.

### 8. Verificar `.gitignore`

Confirmar que `.env` y archivos sensibles estén ignorados:

```bash
cat .gitignore | grep -E "\.env|secrets|credentials"
```

Si faltan entradas, agregarlas:

```
.env
.claude-credentials
.env.*.local
```

### 9. Primer deploy de prueba

```bash
# Vercel
npx vercel --prod

# Fly.io
flyctl launch
flyctl deploy

# Railway
npx @railway/cli up
```

### 10. Crear issue de seguimiento

```bash
gh issue create \
  --title "Deploy: configurar pipeline CI/CD" \
  --body "Archivos generados por /deploy-setup:
- [ ] Dockerfile
- [ ] .github/workflows/deploy.yml
- [ ] .env.example
- [ ] Secrets configurados en GitHub
- [ ] Primer deploy exitoso" \
  --label "devops"
```

## Output esperado

```
=== Deploy setup completo ===
Stack detectado:  Next.js
Proveedor:        Vercel

Archivos generados:
  ✓ Dockerfile
  ✓ .github/workflows/deploy.yml
  ✓ .env.example

Secrets necesarios en GitHub:
  ✗ VERCEL_TOKEN        — falta
  ✗ VERCEL_ORG_ID       — falta
  ✗ VERCEL_PROJECT_ID   — falta

Próximo paso: gh secret set VERCEL_TOKEN
```

## Siguiente paso

- **Deploy exitoso a producción** → monitorear métricas 30 min
- **Deploy rompió producción** → `/rollback` inmediato
- **Error en el pipeline de CI** → `/debug` con los logs del workflow
- **Primer deploy completado** → crear branch `staging` y `dev` si no existen; documentar proceso en `CLAUDE.md`

## Notas

- Siempre generar el workflow con los 3 branches protegidos (main/staging/dev).
- En PRs, hacer deploy a un entorno de preview si el proveedor lo soporta (Vercel, Railway).
- Nunca commitear `.env` — solo `.env.example`.
- Si el proyecto usa Postgres, verificar que `DATABASE_URL` apunte a la DB de producción, no a la local.
- Para Flutter móvil, el deploy requiere pasos adicionales (signing, App Store Connect, Play Store) — abrir un issue separado para ese flujo.
