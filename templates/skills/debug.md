---
name: debug
description: Analiza un error o log, identifica la causa raíz y aplica el fix.
---

# /debug

Analiza un error o log, identifica la causa raíz, propone el fix y lo aplica.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

- Cuando `/apply` o `/test` reportan un error que no se resuelve en 2 intentos.
- Cuando hay un bug en producción reportado en un issue.
- Cuando hay un error en el pipeline de CI/CD.

## Pasos

### 1. Capturar el error completo

Pedir al dev el error completo: stack trace, logs, request/response si aplica.

```bash
# Logs recientes del servidor (Docker)
docker compose logs --tail=100 <servicio> 2>&1

# Logs de CI
gh run view --log-failed 2>&1 | tail -100

# Logs de la app Node
npm run dev 2>&1 | tail -50

# Logs Django
python manage.py runserver 2>&1 | tail -50
```

### 2. Clasificar el error

| Tipo | Señales | Estrategia |
|---|---|---|
| **Error de lógica** | AssertionError, valores incorrectos | Leer el código + tests |
| **Error de integración** | ConnectionError, timeout, 404/500 | Verificar credenciales, URLs, contratos de API |
| **Error de entorno** | ModuleNotFoundError, missing env var | Verificar .env, deps instaladas |
| **Error de tipos** | TypeError, undefined is not a function | Revisar interfaces y contratos |
| **Error de concurrencia** | Race condition, deadlock | Revisar locks, transacciones |
| **Error de build/CI** | Exit code 1 en workflow | Leer el paso fallido exacto |

### 3. Localizar la causa raíz

```bash
# Buscar el archivo y línea del error en el stack trace
grep -n "<función o clase del error>" --include="*.py" --include="*.ts" --include="*.go" -r .

# Ver el historial de cambios recientes en ese archivo
git log --oneline -10 -- <archivo>
git diff HEAD~1 -- <archivo>
```

Leer el código alrededor de la línea del error — 20 líneas arriba y abajo como mínimo.

### 4. Reproducir el error localmente

Antes de proponer el fix, confirmar que el error es reproducible:

```bash
# Correr solo el test fallido
npm test -- --testPathPattern="<archivo>" --testNamePattern="<nombre>"
uv run pytest tests/<archivo>::<test> -xvs
go test ./... -run <TestName> -v
```

### 5. Proponer y aplicar el fix

- Describir en una línea **qué está fallando y por qué**
- Mostrar el diff exacto del cambio propuesto
- Aplicar el cambio
- Correr el test que fallaba para confirmar que pasa

```bash
# Verificar fix
npm test -- --testPathPattern="<archivo>" 2>&1
# o
uv run pytest tests/<archivo> -xvs 2>&1
```

### 6. Verificar que no se rompió nada más

```bash
# Correr el suite completo después del fix
npm test 2>&1 | tail -20
uv run pytest -q 2>&1 | tail -20
go test ./... 2>&1 | tail -20
```

### 7. Documentar el fix en el issue

```bash
gh issue comment <N> --body "### Fix aplicado — /debug

**Error:** \`<descripción del error>\`
**Causa raíz:** <qué estaba mal exactamente>
**Fix:** <qué se cambió y por qué>
**Verificado:** tests pasando ✓"
```

## Output esperado

```
=== /debug — Análisis ===

Error: KeyError: 'user_id' en session_middleware.py:47
Causa raíz: La sesión se limpia antes de leer user_id en el middleware de logout

Fix aplicado:
  session_middleware.py:47
  - del request.session['user_id']
  + user_id = request.session.pop('user_id', None)

Tests:
  ✓ test_user_logout_clears_session — ahora pasa
  ✓ Suite completa — 47 passed, 0 failed

Listo para: /build
```

## Siguiente paso

- **Fix aplicado y tests verdes** → `/build` (guardar el fix)
- **Fix en hotfix para producción rota** → `/secure` (verificar) → `/deploy` urgente
- **Causa raíz no encontrada tras 3 intentos** → escalar: documentar en el issue y pedir ayuda humana
- **Fix requiere cambios en otros repos** → `/cross` para coordinar

## Notas

- Si el error es en producción y requiere hotfix → crear rama `hotfix/issue-<N>` desde `main`, no desde `dev`.
- Si el error es en CI y no es reproducible localmente → verificar diferencias de entorno (versión de Node/Python, variables de entorno).
- Si después de 3 intentos no se encuentra la causa raíz → escalar: documentar todo lo investigado en el issue y pedir ayuda.
