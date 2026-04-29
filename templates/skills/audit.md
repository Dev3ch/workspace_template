---
name: audit
description: Revisión de seguridad OWASP Top 10 sobre los cambios pendientes. Crea un work-item padre con tasks (sub-issues nativos) por cada hallazgo Critical/High/Medium.
---

# /audit

Revisión de seguridad profunda de los cambios pendientes: OWASP Top 10, auth, autorización, inyección y lógica sensible. Genera un reporte y, si hay hallazgos accionables, crea un **work-item padre tipo `fix`** con label `audit` y **una task (sub-issue nativo) por cada hallazgo Critical/High/Medium** — siguiendo el mismo patrón que `/pentest` y `/plan`.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

- Antes de mergear un PR que toca: autenticación, pagos, uploads, integraciones externas, datos sensibles.
- Cuando se agrega un endpoint nuevo que maneja datos de usuarios.
- Periódicamente sobre `main` para detectar regresiones.

**Diferencia con otros skills:**
- `/secure` → mira el **próximo deploy** (rápido, bloqueante)
- `/audit` → mira el **PR actual** (profundo en lo que cambió)
- `/pentest` → mira **todo el proyecto** (exhaustivo, periódico)

## Modelo de trabajo

Igual que `/pentest`, pero acotado a los cambios del PR:

```
Work-item padre  ([AUDIT] fix)                ← issue padre
  ├─ Task (sub-issue nativo)  ← Critical hallazgo  → label severity-critical
  ├─ Task (sub-issue nativo)  ← High hallazgo      → label severity-high
  └─ Task (sub-issue nativo)  ← Medium hallazgo    → label severity-medium
```

Reglas:
- **Cada hallazgo Critical/High/Medium es una task** (sub-issue nativo del padre vía `addSubIssue`).
- Los **labels describen severidad y categoría OWASP**, no narrativa libre.
- El **body de la task** explica problema, impacto y **remediación propuesta** con diff.
- **Hallazgos Low/Info** van como checkboxes en el body del padre o como comments del PR — no abren task.
- Tanto el padre como cada task se agregan al **GitHub Project** del workspace.
- **Si no hay hallazgos Critical/High/Medium** → no se crea work-item; se reporta ✓ y termina.

## Pasos

### 1. Identificar el scope del audit

```bash
# Archivos modificados en la rama actual vs dev
git diff dev...HEAD --name-only

# Archivos sensibles por convención
git diff dev...HEAD --name-only | grep -E "(auth|payment|upload|admin|user|session)"
```

Concentrar el análisis en esos archivos primero.

### 2. Autenticación y autorización

Para cada endpoint modificado:

- [ ] ¿Requiere autenticación? Si muta estado, debe hacerlo.
- [ ] ¿Verifica que el usuario sea dueño del recurso? (prevención de IDOR)
- [ ] Multi-tenant: ¿filtra por `organization_id` en cada query?
- [ ] ¿Los JWT tienen expiración razonable (< 1h para access tokens)?
- [ ] ¿Hay rate limiting en endpoints sensibles (login, reset password, APIs públicas)?

```bash
# Buscar endpoints sin decorador de auth
grep -rn "@router\|@app\.route\|@api_view" --include="*.py" . | head -30
grep -rn "export.*async function\|export const.*=.*async" --include="*.ts" app/ 2>/dev/null
```

### 3. Inyección

- [ ] No hay SQL raw — todo usa ORM o queries parametrizadas.
- [ ] Input de usuario nunca se interpola en comandos shell (`os.system`, `child_process.exec`).
- [ ] File uploads validan tipo MIME real (no solo extensión) y tamaño máximo.
- [ ] Output HTML se escapa en templates.
- [ ] Headers controlados por usuario se validan (ej: `Host`, `Referer`).

```bash
# SQL raw peligroso
grep -rnE "(execute|raw|query)\s*\(\s*['\"f]" --include="*.py" --include="*.ts" .

# Command injection
grep -rnE "(system|exec|popen|eval)\s*\(" --include="*.py" --include="*.ts" .
```

### 4. OWASP Top 10

| ID | Categoría | Check específico |
|---|---|---|
| A01 | Broken Access Control | Cubierto en paso 2 |
| A02 | Cryptographic Failures | Passwords con bcrypt/argon2; PII cifrado en reposo; TLS en todos los endpoints externos |
| A03 | Injection | Cubierto en paso 3 |
| A04 | Insecure Design | Lógica de negocio valida estado antes de actuar (no solo permisos) |
| A05 | Security Misconfiguration | `DEBUG=False`, CORS restrictivo, headers de seguridad (CSP, HSTS) |
| A06 | Vulnerable Components | Cubierto por `/secure` |
| A07 | Auth Failures | Sesiones se invalidan en logout; IDs no predecibles (UUID v4, no incremental) |
| A08 | Software/Data Integrity | Verificar firmas de dependencias críticas; no usar `npm install` sin lock |
| A09 | Logging Failures | No loguear passwords, tokens, PII; loguear intentos fallidos de auth |
| A10 | SSRF | URLs provistas por usuario se validan contra allowlist |

### 5. Lógica de negocio sensible

Para flujos críticos (pagos, cambios de permisos, eliminación de datos):

- [ ] ¿Hay doble verificación (2FA, confirmación por email) en acciones destructivas?
- [ ] ¿Los montos se calculan en el servidor, no en el cliente?
- [ ] ¿Las transiciones de estado se validan (no se puede "saltar" estados)?
- [ ] ¿Hay race conditions en operaciones concurrentes (ej: doble-gasto)?
- [ ] ¿Hay idempotencia en operaciones que pueden reintentarse?

### 6. Generar reporte consolidado

```bash
REPORT_DIR=/tmp/audit-$(date +%Y%m%d-%H%M)
mkdir -p "$REPORT_DIR/findings"
REPORT="$REPORT_DIR/report.md"
```

Para cada hallazgo, escribir un archivo en `$REPORT_DIR/findings/<NN>-<sev>-<slug>.md` con:

- **Severidad:** Critical / High / Medium / Low / Info
- **Categoría OWASP:** A01 - A10 / Business Logic / Hardening
- **Ubicación:** archivo:línea
- **Descripción:** qué está mal
- **Impacto:** qué puede pasar si se explota
- **Remediación:** cómo corregirlo
- **Ejemplo fix:** diff propuesto
- **Esfuerzo estimado:** S / M / L

### 7. Decisión: crear work-item o no

```
Critical/High/Medium presente  → crear work-item + sub-issues (paso 8 en adelante)
Solo Low/Info                  → comentar en el PR + cerrar reporte (no work-item)
Cero hallazgos                 → reportar ✓ y terminar
```

## Crear el work-item en GitHub (con sub-issues nativos)

### 8. Asegurar que existen los labels

```bash
for label in audit security severity-critical severity-high severity-medium severity-low; do
  gh label create "$label" --color BFD4F2 --description "Audit tagging" 2>/dev/null || true
done
```

Colores recomendados (no bloquea si fallan):
- `severity-critical` → `B60205`
- `severity-high` → `D93F0B`
- `severity-medium` → `FBCA04`
- `severity-low` → `0E8A16`
- `audit` → `5319E7`
- `security` → `B60205`

### 9. Crear el work-item padre (fix + audit)

```bash
BRANCH=$(git branch --show-current)
PR_REF=$(gh pr view --json number --jq .number 2>/dev/null || echo "sin PR")

PARENT_TITLE="[AUDIT] $BRANCH: N hallazgos (C critical, H high, M medium)"

PARENT_URL=$(gh issue create \
  --title "$PARENT_TITLE" \
  --label "fix,audit,security" \
  --body "$(cat <<EOF
## Objetivo

Audit OWASP de los cambios en \`${BRANCH}\` — work-item padre que agrupa los hallazgos accionables como tasks (sub-issues nativos).

## Scope

- Rama auditada: \`${BRANCH}\`
- PR asociado: #${PR_REF}
- Archivos modificados: <n>

## Resumen ejecutivo

- Critical: <n>
- High:     <n>
- Medium:   <n>
- Low:      <n> (comments en PR, sin task)
- Info:     <n> (checkboxes abajo, sin task)

## Tasks

<!-- Se llena con los #N reales después de crear los sub-issues -->
- [ ] #TBD

## Hallazgos Low/Info (no requieren task)

- [ ] <descripción corta + ubicación>
- [ ] <descripción corta + ubicación>

## Criterios de aceptación

- [ ] Todos los hallazgos Critical y High están remediados.
- [ ] Hallazgos Medium tienen owner y fecha objetivo o están remediados.
- [ ] Re-correr \`/audit\` sobre la rama confirma que los hallazgos cerrados ya no aparecen.
- [ ] El PR asociado puede mergearse sin bloqueantes de seguridad.

## Reporte completo

Generado en \`/tmp/audit-<fecha>/\`.
EOF
)")

PARENT_N=$(gh issue view "$PARENT_URL" --json number --jq .number)
PARENT_NODE_ID=$(gh issue view "$PARENT_N" --json id --jq .id)
```

### 10. Crear una task por hallazgo y vincularla como sub-issue nativo

Para **cada hallazgo Critical/High/Medium** (los Low/Info NO abren task):

```bash
SEV="critical"      # critical | high | medium
OWASP="A01"         # A01..A10 | business-logic | hardening
LOCATION="apps/payments/webhook.py:34"

TASK_URL=$(gh issue create \
  --title "[${SEV^^}] ${OWASP}: <descripción corta del hallazgo>" \
  --label "task,security,severity-${SEV},audit" \
  --body "$(cat <<EOF
## Hallazgo

**Severidad:** ${SEV^}
**Categoría OWASP:** ${OWASP}
**Ubicación:** \`${LOCATION}\`

## Descripción del problema

<!-- Qué está mal y por qué es un riesgo -->

## Impacto

<!-- Qué puede pasar si se explota -->

## Remediación propuesta

<!-- Cómo corregirlo, con ejemplo concreto -->

\`\`\`diff
- código vulnerable
+ código corregido
\`\`\`

## Subtareas

- [ ] Implementar fix
- [ ] Agregar test que cubra el caso
- [ ] Verificar que el hallazgo ya no se reproduce al re-correr \`/audit\`

## Criterios de aceptación

- [ ] El hallazgo ya no se detecta sobre la rama.
- [ ] Hay un test que cubre el caso.

## Tipo de cambio (Conventional Commits)

fix | refactor

## Esfuerzo estimado

S | M | L

## Work-item padre

#${PARENT_N}
EOF
)")

TASK_N=$(gh issue view "$TASK_URL" --json number --jq .number)
TASK_NODE_ID=$(gh issue view "$TASK_N" --json id --jq .id)

# Vincular como sub-issue NATIVO del padre (no solo referencia textual)
gh api graphql -f query='
mutation($parent: ID!, $child: ID!) {
  addSubIssue(input: { issueId: $parent, subIssueId: $child }) {
    subIssue { number }
  }
}' -f parent="$PARENT_NODE_ID" -f child="$TASK_NODE_ID"
```

Repetir el bloque anterior para cada hallazgo Critical/High/Medium. **No olvidar la mutación `addSubIssue`** — sin eso, los issues quedan sueltos en lugar de anidados bajo el padre en el work-item view y en el project board.

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

### 13. Si hay PR abierto, comentar el resumen

```bash
if [ "$PR_REF" != "sin PR" ]; then
  gh pr comment "$PR_REF" --body "🔒 **Audit completado** — work-item #${PARENT_N}

Hallazgos: <C> critical · <H> high · <M> medium · <L> low · <I> info
Decisión: <BLOQUEAR merge | aprobar tras Medium | OK>

Ver tasks vinculadas en el work-item padre."
fi
```

## Output esperado

**Con hallazgos accionables:**

```
=== /audit — Reporte ===
Rama:  feat/12-payments
Scope: 8 archivos modificados

Hallazgos:
  ✗ CRITICAL  apps/payments/webhook.py:34
              Firma del webhook de Stripe no se valida
  ⚠  HIGH     apps/payments/views.py:78
              Monto se toma del request sin validar contra catálogo
  ⚠  MEDIUM   apps/users/serializers.py:12
              PasswordField se expone en GET /api/users/<id>
  ℹ  LOW      Sin rate limit en POST /api/auth/login (comentado en PR)

Resumen: 1 critical · 1 high · 1 medium · 1 low

Reporte completo: /tmp/audit-2026-04-29-1430/report.md

GitHub:
  Work-item padre: [AUDIT] #145 — feat/12-payments: 3 hallazgos (1C, 1H, 1M)
  Sub-issues nativos creados: 3
    severity-critical: #146
    severity-high:     #147
    severity-medium:   #148
  Hallazgos Low: 1 (comentado en PR #142)

  Project: agregados 4 items (1 padre + 3 tasks)

Decisión: ✗ BLOQUEAR merge hasta resolver critical + high
```

**Sin hallazgos accionables:**

```
=== /audit — Reporte ===
Rama:  feat/12-payments
Scope: 8 archivos modificados

✓ Sin hallazgos Critical/High/Medium.
ℹ  3 hallazgos Info (comentados en PR #142, no requieren cambios).

Resultado: ✓ APROBADO para merge.
```

## Siguiente paso

- **Hallazgos Critical/High** → `/apply` en cada sub-issue con prioridad máxima (rama del work-item: `fix/<PARENT_N>-audit-<rama>`).
- **Solo Medium o menos** → resolver en el mismo PR antes del merge si es posible.
- **Sin hallazgos** → continuar con `/build` o `/review` y luego al flujo de deploy.

## Notas

- `/audit` no ejecuta nada destructivo — solo lee, reporta y crea issues.
- **Cada hallazgo Critical/High/Medium abre una task con su severidad y categoría OWASP como labels.** No se hacen issues sueltos sin padre.
- Los Low/Info no abren task — se comentan en el PR o se listan como checkboxes en el body del padre.
- Para fixes complejos, asignar la task al dev correspondiente y delegar a `/apply`.
- Este skill no reemplaza una pentest profesional — es la primera línea de defensa continua.
- **No ejecutar** `/audit` dentro de `/apply` o `/build` — es un skill independiente que interrumpiría el flujo.
