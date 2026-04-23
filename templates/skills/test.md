---
name: test
description: Corre el suite completo, reporta cobertura e identifica tests faltantes.
---

# /test

Corre el suite completo de tests, reporta cobertura e identifica qué falta cubrir.

## Cuándo invocar

- Después de `/apply` para verificar que la implementación está completa.
- Antes de `/review` para asegurar que el PR no tiene tests rotos.
- Antes de `/secure` y `/deploy` como gate de calidad.

## Pasos

### 1. Detectar el stack y comando de tests

```bash
# Node
cat package.json | grep -A5 '"scripts"'

# Python
cat pyproject.toml | grep -A5 '\[tool.pytest'
ls pytest.ini setup.cfg 2>/dev/null

# Go
ls *_test.go **/*_test.go 2>/dev/null

# Flutter
ls test/ 2>/dev/null
```

### 2. Correr el suite completo

**Node / Next.js / React:**
```bash
npm test -- --coverage --passWithNoTests 2>&1
```

**Django:**
```bash
uv run python manage.py test --verbosity=2 2>&1
# o con pytest
uv run pytest --cov=. --cov-report=term-missing -q 2>&1
```

**FastAPI:**
```bash
uv run pytest --cov=. --cov-report=term-missing -q 2>&1
```

**Go:**
```bash
go test ./... -cover -count=1 2>&1
```

**Flutter:**
```bash
flutter test --coverage 2>&1
```

### 3. Analizar resultados

Para cada test fallido:
- Identificar si es un test roto por el código nuevo o un test preexistente roto
- Si es por código nuevo → reportar al dev qué función está fallando
- Si es preexistente → registrarlo como deuda técnica separada, no bloqueante

### 4. Calcular cobertura

Identificar módulos/archivos con cobertura baja (< 70%):

```bash
# Node — leer coverage/lcov-report/index.html o coverage/coverage-summary.json
cat coverage/coverage-summary.json 2>/dev/null | \
  python3 -c "import json,sys; d=json.load(sys.stdin)['total']; print(f'Lines: {d[\"lines\"][\"pct\"]}%')"

# Python
uv run pytest --cov=. --cov-report=term-missing -q 2>/dev/null | grep TOTAL
```

### 5. Identificar tests faltantes

Buscar código sin tests:

```bash
# Funciones públicas sin test correspondiente (Node)
grep -rn "^export function\|^export const\|^export async function" \
  --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude="*.test.*" --exclude="*.spec.*" . \
  | head -30

# Vistas de Django sin test
grep -rn "class.*View\|def.*_view" \
  --include="*.py" --exclude="test_*" . \
  | grep -v "test\|migration" | head -30
```

### 6. Generar reporte

```
=== /test — Reporte ===

Suite:     47 passed / 2 failed / 0 skipped
Cobertura: 84% líneas / 79% ramas

Tests fallidos:
  ✗ test_payment_webhook_invalid_signature
    → PaymentView.process() no maneja firma inválida
  ✗ test_user_logout_clears_session
    → SessionMiddleware.clear() lanza KeyError

Cobertura baja (< 70%):
  apps/notifications/tasks.py   — 45%
  apps/reports/generators.py    — 62%

Tests sugeridos:
  + test_payment_webhook_invalid_signature
  + test_empty_cart_checkout
  + test_concurrent_inventory_update
```

### 7. Decidir si continuar

- **Todo verde + cobertura > 70%** → listo para `/build` o `/review`
- **Tests fallidos por código nuevo** → volver a `/apply` o llamar a `/debug`
- **Tests fallidos preexistentes** → crear issue de deuda técnica y continuar
- **Cobertura < 50% en módulo crítico** → escribir tests antes de continuar

## Siguiente paso

- **Todo verde + cobertura buena** → `/build` (guardar progreso) o `/review` (si ya hay PR)
- **Tests fallan por código nuevo** → `/debug` con el error específico
- **Cobertura baja en módulo crítico** → `/apply` para agregar los tests faltantes
- **Tests preexistentes rotos** → crear issue de deuda técnica con `/plan` y continuar

## Notas

- No modificar tests existentes para que pasen — solo el código de producción.
- Los tests de integración que requieren DB deben correr contra una DB real, no mocks.
- Si el proyecto no tiene tests, crear al menos los del módulo que se implementó en `/apply`.
