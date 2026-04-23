# Testing Rules

## Nombres descriptivos

- `def test_rejects_request_when_email_missing()` > `def test_1()`
- Agrupar con `class TestX` (pytest) o `describe` (jest/vitest).
- Docstrings en español, nombres de funciones en inglés.

## Independencia

- Cada test debe ser independiente — sin estado mutable compartido entre tests.
- Fixtures se re-crean por test.
- En JS, evitar mocks globales que persistan entre tests.

## Real > mock

- Preferir implementaciones reales sobre mocks.
- Mock solo servicios externos (APIs de terceros, pasarelas de pago, servicios de email).
- En backend: usar DB real (test container), NO sqlite para proyectos con PostgreSQL.
- En frontend: usar MSW (mock service worker) para mockear fetch/axios.

## Qué testear

Cada feature debe tener al menos:
- **Happy path**: el caso principal funciona.
- **Validation errors**: inputs inválidos devuelven errores claros.
- **Auth errors**: usuario sin permiso → 401/403.
- **Edge cases**: bordes del dominio.

## Obligatorios para mutaciones

Cualquier endpoint/hook que cambia estado requiere:
- Test que el estado cambia correctamente.
- Test que re-ejecutar es idempotente (si aplica) o conflict (409).
- Test que el usuario sin permiso recibe 403.

## Prohibidos

- NO escribir tests vacíos sin asserts.
- NO escribir tests que siempre pasen (`assert True`).
- Al escribir un test nuevo, correrlo con el código roto para confirmar que **falla**, luego arreglar y confirmar que **pasa**.

## Cleanup

- Tests dejan la DB limpia.
- No hacer `Model.objects.all().delete()` en tests — usar fixtures scoped.
