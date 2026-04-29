---
name: secure
description: Pre-deploy checklist obligatorio: env vars, secrets, CVEs, Dockerfile, CI.
---

# /secure

Pre-deploy checklist obligatorio: valida que el proyecto está listo para publicarse sin comprometer secrets, credenciales ni estabilidad.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

**Obligatorio antes de cada `/deploy`.** No es opcional.

También antes de:
- Merge a `main`
- Promoción de `staging` a `main`
- Primer deploy de un entorno nuevo

## Pasos

### 1. Variables de entorno

Verificar que todas las vars usadas en el código tengan correspondencia en `.env.example` y en los secrets de GitHub:

```bash
# Extraer vars usadas en el código
grep -rhoE "process\.env\.[A-Z_]+|os\.environ\[.[A-Z_]+|os\.getenv\(['\"][A-Z_]+" \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.go" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=__pycache__ . \
  | grep -oE '[A-Z_]+' | sort -u > /tmp/vars-used.txt

# Vars declaradas en .env.example
grep -oE '^[A-Z_]+' .env.example 2>/dev/null | sort -u > /tmp/vars-example.txt

# Diferencia: usadas pero no declaradas
comm -23 /tmp/vars-used.txt /tmp/vars-example.txt

# Secrets configurados en GitHub
gh secret list --json name --jq '.[].name' | sort -u > /tmp/vars-github.txt

# Diferencia: declaradas pero no configuradas en GitHub
comm -23 /tmp/vars-example.txt /tmp/vars-github.txt
```

Bloquear si:
- Hay vars usadas en código que no están en `.env.example`
- Hay vars en `.env.example` sin secret correspondiente en GitHub

### 2. Secrets hardcodeados

Escanear el código por credenciales pegadas:

```bash
# Patrones peligrosos
grep -rnE "(api[_-]?key|token|password|secret)['\"]?\s*[:=]\s*['\"][^'\"]{8,}" \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.go" \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude="*.test.*" --exclude="*.spec.*" .

# Claves privadas
grep -rn "BEGIN .*PRIVATE KEY" . 2>/dev/null

# URLs con credenciales embebidas
grep -rnE "://[^:]+:[^@]+@" --include="*.ts" --include="*.py" --include="*.go" .
```

Cualquier match → bloquear deploy.

### 3. `.gitignore` correcto

```bash
# Verificar que archivos sensibles están ignorados
for f in .env .claude-credentials .env.production credentials.json secrets.yaml; do
  if git check-ignore "$f" >/dev/null 2>&1 || [ ! -f "$f" ]; then
    echo "✓ $f"
  else
    echo "✗ $f NO está en .gitignore"
  fi
done

# Verificar si alguno fue commiteado por error
git log --all --full-history -- .env .claude-credentials 2>/dev/null | head -5
```

### 4. Dependencias con vulnerabilidades conocidas

```bash
# Node
npm audit --audit-level=high --json 2>/dev/null | \
  jq '.metadata.vulnerabilities'

# Python (pip-audit o uv)
uv pip compile pyproject.toml --format requirements-txt 2>/dev/null | \
  pip-audit -r /dev/stdin 2>&1 || true

# Go
govulncheck ./... 2>&1 || true
```

Bloquear si hay vulnerabilidades **critical** o **high** sin remediar.

### 5. Dockerfile (si aplica)

```bash
if [ -f Dockerfile ]; then
  # Usuario root
  grep -q "^USER " Dockerfile || echo "⚠  Dockerfile no define USER — correrá como root"

  # Puerto expuesto
  grep -q "^EXPOSE " Dockerfile || echo "⚠  Dockerfile no declara EXPOSE"

  # COPY . . sin .dockerignore
  grep -q "^COPY \. " Dockerfile && [ ! -f .dockerignore ] && \
    echo "⚠  COPY . . sin .dockerignore — puede filtrar archivos sensibles"
fi
```

### 6. Workflow de CI corre tests antes del deploy

```bash
# Verificar que deploy.yml depende de un job de test
grep -A3 "needs:" .github/workflows/deploy.yml 2>/dev/null
```

Si `deploy.yml` no tiene `needs: test` → bloquear.

### 7. Configuración de producción

```bash
# Django: DEBUG=False en producción
grep -rn "DEBUG\s*=\s*True" --include="*.py" config/ settings/ 2>/dev/null

# Next.js: NODE_ENV=production en el workflow
grep "NODE_ENV" .github/workflows/deploy.yml 2>/dev/null

# Credenciales por defecto (admin/admin, root/root)
grep -rnE "(admin|root|test):(admin|root|test|password|1234)" \
  --include="*.yaml" --include="*.yml" --include="*.env*" .
```

### 8. Tests verdes

```bash
# Correr suite completo como último check
npm test 2>&1 | tail -5
# o: uv run pytest -q 2>&1 | tail -5
# o: go test ./... 2>&1 | tail -5
```

Tests en rojo → bloquear deploy.

### 9. Reportar estado

```
=== /secure — Pre-deploy checklist ===

✓ Variables de entorno:     todas declaradas en .env.example
✓ Secrets en GitHub:        todas configuradas
✓ Secrets hardcodeados:     ninguno detectado
✓ .gitignore:               .env protegido
✗ Dependencias:             2 vulnerabilidades HIGH en lodash@4.17.20
                            → npm update lodash
✓ Dockerfile:               USER nobody, EXPOSE 3000, .dockerignore presente
✓ CI:                       deploy depende de test
✓ Configuración prod:       DEBUG=False, sin credenciales por defecto
✓ Tests:                    47 passed / 0 failed

Resultado: ✗ 1 bloqueante encontrado — resolver antes de /deploy
```

### 10. Si pasa todo

```
✓ Pre-deploy checklist completo
→ Listo para /deploy
```

### 11. Si hay bloqueantes

Crear issue con los hallazgos:

```bash
gh issue create \
  --title "Pre-deploy: resolver bloqueantes de seguridad" \
  --body "Resultado de /secure — $(date +%Y-%m-%d)

Bloqueantes:
- [ ] <bloqueante 1>
- [ ] <bloqueante 2>

Una vez resueltos, correr /secure de nuevo antes de /deploy." \
  --label "security,blocker"
```

## Notas

- Este skill es solo para **pre-deploy**. Para revisión profunda de código OWASP, usar `/audit`.
- Si algún check falla por falso positivo, documentarlo en `.claude/secure-exceptions.md` con justificación — no ignorarlo silenciosamente.
- En hotfixes críticos, `/secure` puede correrse en modo rápido (solo pasos 1, 2, 3, 8) pero nunca saltarse completamente.
- Siguiente paso tras `/secure` exitoso: `/deploy`. Si hay bloqueantes: `/debug` o `/apply` para resolverlos.
