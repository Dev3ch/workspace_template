# Reglas de stack — Go

## Estructura del proyecto

Seguir la convención estándar de Go:

```
cmd/           ← entrypoints (main.go por servicio)
internal/      ← lógica privada del módulo
pkg/           ← código exportable / reutilizable
api/           ← definiciones OpenAPI / protobuf
```

## Convenciones de código

- Nombres en `camelCase` para variables locales, `PascalCase` para exportados.
- Errores siempre como último valor de retorno: `func X() (T, error)`.
- No usar `panic` en código de producción — retornar error siempre.
- Interfaces pequeñas: preferir definir la interfaz donde se consume, no donde se implementa.

## Testing

- Archivos de test en el mismo paquete: `foo_test.go`.
- Usar `t.Helper()` en helpers de test.
- Subtests con `t.Run("nombre", func(t *testing.T) {...})`.
- Mocks con `testify/mock` o interfaces manuales — no usar `reflect` para mockear.

## Dependencias

- Gestión con Go modules (`go.mod` / `go.sum`).
- No commitear binarios compilados.
- Actualizar deps con `go mod tidy` antes de cada PR.

## Linting

```bash
golangci-lint run ./...
```

Correr antes de cada commit. Configuración en `.golangci.yml`.
