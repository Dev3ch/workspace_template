---
name: secure
description: Pre-deploy checklist obligatorio (env vars, secrets, CVEs, Dockerfile, CI). Si encuentra bloqueantes, crea work-item padre con tasks (sub-issues) por cada bloqueante.
---

# /secure

Pre-deploy checklist obligatorio: valida que el proyecto está listo para publicarse sin comprometer secrets, credenciales ni estabilidad. Si encuentra bloqueantes, **crea un work-item padre tipo `fix`** con label `security` y **una task (sub-issue nativo) por cada bloqueante** — siguiendo el mismo patrón que `/pentest` y `/audit`.

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

## Modelo de trabajo

Cuando hay bloqueantes, se crea estructura work-item + sub-issues:

```
Work-item padre  ([SECURITY] fix)             ← issue padre
  ├─ Task (sub-issue nativo)  ← Bloqueante 1   → label severity-critical
  ├─ Task (sub-issue nativo)  ← Bloqueante 2   → label severity-high
  └─ Task (sub-issue nativo)  ← Warning serio  → label severity-medium
```

Reglas:
- **Cada bloqueante es una task** (sub-issue nativo del padre vía `addSubIssue`).
- Los **labels describen severidad y categoría del check**, no narrativa libre.
- El **body de la task** explica el check fallido, el impacto y la **remediación concreta**.
- **Warnings no bloqueantes** van como checkboxes en el body del padre, no como tasks.
- Tanto el padre como cada task se agregan al **GitHub Project** del workspace.
- **Si pasa todo** → no se crea work-item; se reporta ✓ y `/deploy` puede continuar.

Categorías de check (usadas como label secundario):
- `env-vars` — variables faltantes / desincronizadas
- `secrets` — credenciales hardcodeadas / leaked
- `gitignore` — archivos sensibles no ignorados
- `deps` — CVEs en dependencias
- `dockerfile` — config insegura del contenedor
- `ci` — pipeline mal configurado
- `prod-config` — DEBUG/credenciales por defecto
- `tests` — suite en rojo

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
- Hay vars usadas en código que no están en `.env.example` → categoría `env-vars`, severity `high`
- Hay vars en `.env.example` sin secret correspondiente en GitHub → categoría `env-vars`, severity `high`

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

Cualquier match → bloqueante categoría `secrets`, severity `critical`.

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

Archivo sensible no ignorado → bloqueante categoría `gitignore`, severity `high`.
Archivo sensible commiteado en historial → bloqueante categoría `secrets`, severity `critical` (rotar credenciales además de limpiar historial).

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

CVEs **critical** → bloqueante categoría `deps`, severity `critical`.
CVEs **high** → bloqueante categoría `deps`, severity `high`.

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

`USER` ausente → bloqueante categoría `dockerfile`, severity `medium`.
`COPY . .` sin `.dockerignore` → bloqueante categoría `dockerfile`, severity `high` (puede filtrar `.env`, `.git`).

### 6. Workflow de CI corre tests antes del deploy

```bash
grep -A3 "needs:" .github/workflows/deploy.yml 2>/dev/null
```

Si `deploy.yml` no tiene `needs: test` → bloqueante categoría `ci`, severity `high`.

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

`DEBUG=True` en prod → bloqueante categoría `prod-config`, severity `critical`.
Credenciales por defecto → bloqueante categoría `prod-config`, severity `critical`.

### 8. Tests verdes

```bash
npm test 2>&1 | tail -5
# o: uv run pytest -q 2>&1 | tail -5
# o: go test ./... 2>&1 | tail -5
```

Tests en rojo → bloqueante categoría `tests`, severity `critical`.

### 9. Generar reporte consolidado

```bash
REPORT_DIR=/tmp/secure-$(date +%Y%m%d-%H%M)
mkdir -p "$REPORT_DIR/blockers"
REPORT="$REPORT_DIR/report.md"
```

Para cada bloqueante, escribir un archivo en `$REPORT_DIR/blockers/<NN>-<sev>-<cat>.md` con:

- **Severidad:** Critical / High / Medium
- **Categoría:** env-vars / secrets / gitignore / deps / dockerfile / ci / prod-config / tests
- **Check fallido:** descripción
- **Ubicación:** archivo:línea (si aplica)
- **Impacto:** qué pasa si se deploya con esto
- **Remediación:** comando o cambio concreto
- **Esfuerzo estimado:** S / M / L

### 10. Reportar estado al dev (antes de crear issues)

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

Resultado: ✗ 1 bloqueante encontrado — creando work-item con tasks…
```

### 11. Decisión: crear work-item o no

```
Algún bloqueante presente  → crear work-item + sub-issues (paso 12 en adelante)
Cero bloqueantes           → reportar ✓ y permitir /deploy (saltar a "Si pasa todo")
```

## Crear el work-item en GitHub (con sub-issues nativos)

### 12. Asegurar que existen los labels

```bash
for label in security severity-critical severity-high severity-medium blocker \
             env-vars secrets gitignore deps dockerfile ci prod-config tests; do
  gh label create "$label" --color BFD4F2 --description "Secure pre-deploy tagging" 2>/dev/null || true
done
```

Colores recomendados (no bloquea si fallan):
- `severity-critical` → `B60205`
- `severity-high` → `D93F0B`
- `severity-medium` → `FBCA04`
- `security` → `B60205`
- `blocker` → `B60205`

### 13. Crear el work-item padre (fix + security + blocker)

```bash
BRANCH=$(git branch --show-current)

PARENT_TITLE="[SECURITY] Pre-deploy bloqueantes en $BRANCH (C critical, H high, M medium)"

PARENT_URL=$(gh issue create \
  --title "$PARENT_TITLE" \
  --label "fix,security,blocker" \
  --body "$(cat <<EOF
## Objetivo

Pre-deploy checklist falló — work-item padre que agrupa los bloqueantes como tasks (sub-issues nativos). \`/deploy\` no debe ejecutarse hasta que todas las tasks Critical/High estén cerradas.

## Scope

- Rama: \`${BRANCH}\`
- Fecha del check: $(date +%Y-%m-%d)

## Resumen del checklist

| Check | Estado |
|---|---|
| Variables de entorno | <✓/✗> |
| Secrets hardcodeados | <✓/✗> |
| .gitignore | <✓/✗> |
| Dependencias (CVEs) | <✓/✗> |
| Dockerfile | <✓/✗> |
| CI (deploy depende de test) | <✓/✗> |
| Configuración de producción | <✓/✗> |
| Tests | <✓/✗> |

## Tasks

<!-- Se llena con los #N reales después de crear los sub-issues -->
- [ ] #TBD

## Warnings no bloqueantes

- [ ] <descripción corta + recomendación>

## Criterios de aceptación

- [ ] Todas las tasks Critical y High están cerradas.
- [ ] Tasks Medium tienen owner y plan o están cerradas.
- [ ] Re-correr \`/secure\` sobre la rama pasa sin bloqueantes.
- [ ] \`/deploy\` puede ejecutarse.

## Reporte completo

Generado en \`/tmp/secure-<fecha>/\`.
EOF
)")

PARENT_N=$(gh issue view "$PARENT_URL" --json number --jq .number)
PARENT_NODE_ID=$(gh issue view "$PARENT_N" --json id --jq .id)
```

### 14. Crear una task por bloqueante y vincularla como sub-issue nativo

Para **cada bloqueante** detectado:

```bash
SEV="critical"        # critical | high | medium
CAT="deps"            # env-vars | secrets | gitignore | deps | dockerfile | ci | prod-config | tests
LOCATION="package.json"
CHECK="lodash@4.17.20 — CVE-2021-23337 (Command Injection)"
FIX="npm update lodash && npm audit"

TASK_URL=$(gh issue create \
  --title "[${SEV^^}] ${CAT}: ${CHECK}" \
  --label "task,security,severity-${SEV},${CAT},blocker" \
  --body "$(cat <<EOF
## Bloqueante pre-deploy

**Severidad:** ${SEV^}
**Categoría:** ${CAT}
**Ubicación:** \`${LOCATION}\`

## Check fallido

${CHECK}

## Impacto

<!-- Qué pasa si se deploya con esto -->

## Remediación

\`\`\`bash
${FIX}
\`\`\`

## Subtareas

- [ ] Aplicar la remediación
- [ ] Re-correr el check específico y confirmar que pasa
- [ ] Re-correr \`/secure\` completo y verificar que esta task ya no aparece

## Criterios de aceptación

- [ ] El check ya no falla.
- [ ] No se introducen regresiones en otros checks.

## Tipo de cambio (Conventional Commits)

fix | chore

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

Repetir el bloque anterior para cada bloqueante. **No olvidar la mutación `addSubIssue`** — sin eso, los issues quedan sueltos.

### 15. Agregar work-item + tasks al GitHub Project

```bash
PROJECT_NUMBER=$(jq -r '.githubProject.number' .claude/.workspace-version)
PROJECT_OWNER=$(jq -r '.githubProject.owner' .claude/.workspace-version)

gh project item-add "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --url "$PARENT_URL"

for TASK_URL in "${TASK_URLS[@]}"; do
  gh project item-add "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --url "$TASK_URL"
done
```

### 16. Actualizar el body del padre con los #N reales

```bash
gh issue edit "$PARENT_N" --body "$(actualizar el body con la lista real)"
```

### 17. Si pasa todo (sin bloqueantes)

```
✓ Pre-deploy checklist completo
→ Listo para /deploy
```

No se crea work-item ni tasks. `/deploy` puede continuar.

## Output esperado

**Con bloqueantes:**

```
=== /secure — Pre-deploy checklist ===
Rama: feat/12-payments

✗ 2 bloqueantes encontrados — creando work-item

GitHub:
  Work-item padre: [SECURITY] #150 — Pre-deploy bloqueantes en feat/12-payments
  Sub-issues nativos creados: 2
    severity-critical: #151 (deps: lodash CVE-2021-23337)
    severity-high:     #152 (env-vars: STRIPE_SECRET_KEY no configurada)

  Project: agregados 3 items (1 padre + 2 tasks)

Resultado: ✗ /deploy NO debe ejecutarse hasta cerrar las tasks Critical/High.
```

**Sin bloqueantes:**

```
=== /secure — Pre-deploy checklist ===
Rama: feat/12-payments

✓ Todos los checks pasan.
✓ Listo para /deploy.
```

## Siguiente paso

- **Bloqueantes presentes** → `/apply` en cada sub-issue para resolverlos. Re-correr `/secure` cuando todas las tasks Critical/High estén cerradas.
- **Sin bloqueantes** → `/deploy`.
- **Falsos positivos recurrentes** → documentar en `.claude/secure-exceptions.md` con justificación; nunca ignorar silenciosamente.

## Notas

- Este skill es solo para **pre-deploy**. Para revisión profunda de código OWASP, usar `/audit`. Para barrida completa del proyecto, usar `/pentest`.
- En hotfixes críticos, `/secure` puede correrse en modo rápido (solo pasos 1, 2, 3, 8) pero nunca saltarse completamente.
- **Cada bloqueante abre una task** — no se crea un solo issue plano con checklist.
- Los warnings no bloqueantes van como checkboxes en el body del padre.
- **No ejecutar** `/secure` dentro de `/apply` o `/build` — es un skill independiente.
