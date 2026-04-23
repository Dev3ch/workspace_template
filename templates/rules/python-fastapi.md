# Python / FastAPI Rules

## Stack

- Python 3.12+
- FastAPI + Pydantic v2
- httpx (async) para llamadas HTTP a otros servicios
- pytest para tests
- ruff para lint

## Estructura

```
app/
├── main.py          ← FastAPI() instance
├── config.py        ← BaseSettings de pydantic-settings
├── routers/         ← un archivo por dominio
├── models/          ← Pydantic models (request/response)
└── services/        ← lógica de negocio
```

## Patterns

- `app/config.py` con `BaseSettings` lee variables de entorno.
- Autenticación via `Depends(verify_service_key)` — valida header `X-Service-Key`.
- httpx async para llamar a otros servicios.
- Todos los endpoints que hagan callback deben propagar `X-Request-Id`.

## Naming

- `snake_case` para variables, funciones, módulos.
- `PascalCase` para clases Pydantic y clases Python.
- Routers en plural: `/invoices`, no `/invoice`.

## Error handling

- Usar `HTTPException` con status codes semánticos.
- Loguear errores antes de re-raise.
- Nunca `except Exception: pass`.

## Tests

- Usar `TestClient` de FastAPI para tests de integración.
- Mockear servicios externos con `httpx.MockTransport` o `respx`.

## Prohibidos

- NO `print()` — usar `logging.getLogger(__name__)`.
- NO acceso directo a DB — esta capa sólo llama a la API central.
