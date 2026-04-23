# Python / Django Rules

## Stack

- Python 3.12+
- Django + Django REST Framework
- PostgreSQL
- Redis (caching)
- httpx para HTTP entre servicios
- pytest + pytest-django para tests
- ruff para lint

## Django specifics

- Apps en `apps/<name>/`.
- Cada app tiene: `models.py`, `serializers.py`, `views.py`, `urls.py`, `migrations/`.
- Tests en `tests/test_<domain>.py` a nivel proyecto.
- Settings split en `config/settings/{base,local,production,test}.py`.

## DRF patterns

- ViewSets para recursos CRUD.
- Serializers: `<Model>Serializer` para read, `<Model>CreateSerializer` para POST.
- `filterset_fields` para filtros simples.
- Permissions siempre explícitas. Nunca usar defaults.
- `@transaction.atomic` en mutaciones que tocan múltiples rows.

## Multi-tenant

- TODO endpoint autenticado filtra por organización.
- NUNCA hacer queries sin filter por organización — es un leak cross-tenant.

## Concurrencia

- `SELECT FOR UPDATE` obligatorio al mutar state concurrente.
- Optimistic locking con campo `version`: en el body viene `version`, al grabar hacer `UPDATE ... WHERE version=X`. Si no actualiza, devolver 409.

## Imports

- Absolutos siempre.
- Nunca imports relativos con puntos.
- Orden: stdlib → third-party → django → local.

## Naming

- `snake_case` para variables, funciones, módulos.
- `PascalCase` para clases.
- `UPPER_SNAKE_CASE` para constantes.
- Modelos en singular. Endpoints en plural.

## Tests

- `@pytest.mark.django_db` obligatorio en tests que tocan DB.
- Assertions claras: `assert resp.status_code == 200`.

## Prohibidos

- NO `print()` — usar `logging.getLogger(__name__)`.
- NO `except Exception: pass` — siempre loguear o re-raise.
- NO SQL raw salvo caso extremo — usar ORM.
