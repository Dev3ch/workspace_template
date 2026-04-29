---
name: audit
description: Revisión de seguridad OWASP Top 10 de los cambios pendientes. Usar antes de mergear cambios sensibles.
---

# /audit

Revisión de seguridad profunda de los cambios pendientes: OWASP Top 10, auth, autorización, inyección y lógica sensible.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

- Antes de mergear un PR que toca: autenticación, pagos, uploads, integraciones externas, datos sensibles.
- Cuando se agrega un endpoint nuevo que maneja datos de usuarios.
- Periódicamente sobre `main` para detectar regresiones.
- A diferencia de `/secure` (pre-deploy, infra), `/audit` revisa el **código de aplicación**.

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

### 6. Generar reporte

Para cada hallazgo:

```
Severidad:      Critical | High | Medium | Low | Info
Categoría:      OWASP A01-A10 | Business Logic | Hardening
Ubicación:      archivo:línea
Descripción:    qué está mal
Impacto:        qué puede pasar si se explota
Recomendación:  cómo corregirlo
Ejemplo fix:    diff propuesto
```

### 7. Priorización

```
Critical  → bloquea merge, abrir issue inmediato con label `security-critical`
High      → bloquea merge, abrir issue con label `security-high`
Medium    → no bloquea, abrir issue con label `security`
Low/Info  → agregar como comment en el PR, no crear issue aparte
```

### 8. Commit del reporte

Si hay hallazgos, crear issue con el detalle:

```bash
gh issue create \
  --title "Security audit: hallazgos en <rama>" \
  --body "$(cat /tmp/audit-report.md)" \
  --label "security"
```

## Output esperado

```
=== /audit — Reporte ===
Scope: 8 archivos modificados en feat/issue-42-payments

Hallazgos:
  ✗ CRITICAL  apps/payments/webhook.py:34
              Firma del webhook de Stripe no se valida
              → Cualquiera puede simular un pago exitoso
              Fix: usar stripe.Webhook.construct_event()

  ⚠  HIGH     apps/payments/views.py:78
              Monto se toma del request sin validar contra catálogo
              → Cliente puede pagar $0.01 por un item de $100
              Fix: cargar precio desde DB usando product_id

  ⚠  MEDIUM   apps/users/serializers.py:12
              PasswordField se expone en GET /api/users/<id>
              Fix: write_only=True

  ℹ  LOW      Sin rate limit en POST /api/auth/login
              → Fuerza bruta posible
              Fix: agregar DRF throttle_classes o similar

Resumen: 1 critical · 1 high · 1 medium · 1 low
Decisión: ✗ BLOQUEAR merge hasta resolver critical + high
```

## Notas

- `/audit` no ejecuta nada destructivo — solo lee y reporta.
- Para fixes complejos, abrir issue separado y delegar a `/apply`.
- Este skill no reemplaza una pentest profesional — es la primera línea de defensa continua.
- Siguiente paso: si hay hallazgos → `/apply` (o `/debug`) en los fixes. Si todo está limpio → `/build` y continuar al flujo de deploy.
