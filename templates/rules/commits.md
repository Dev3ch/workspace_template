# Commits

## Formato

Conventional Commits enforced por commitlint:

```
<type>(<scope>): <description> #<issue>
```

**Header máximo 100 caracteres.**

## Types válidos

| Type | Cuándo usarlo |
|---|---|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `hotfix` | Fix urgente en producción |
| `refactor` | Refactoring sin cambio de comportamiento |
| `docs` | Cambios solo en documentación |
| `test` | Agregar o corregir tests |
| `chore` | Mantenimiento (deps, config, build) |
| `perf` | Mejoras de rendimiento |
| `ci` | Cambios en CI/CD |
| `build` | Sistema de build, herramientas externas |
| `style` | Formato, espacios, comas (sin cambio lógico) |
| `revert` | Revertir un commit anterior |

## Scope

El scope es el módulo o área afectada: `auth`, `api`, `ui`, `db`, `infra`, etc.

## Ejemplos correctos

```
feat(auth): add JWT refresh token endpoint #42
fix(api): handle null organization_id in invoice list #58
refactor(ui): extract InvoiceTable into reusable component #61
docs(readme): update local setup instructions
chore(deps): bump next.js to 16.2.0
test(auth): add missing 403 test for non-org member #42
```

## Ejemplos incorrectos

```
fix: stuff                    ← sin scope ni issue
updated things                ← no es conventional
feat(auth): Add JWT Token     ← mayúscula en descripción
feat(auth): add JWT token.    ← punto al final
```

## Reglas adicionales

- Referencia el issue con `#N` al final de la descripción cuando aplica.
- Cuerpo del commit (body) opcional, separado por línea en blanco.
- Footer para breaking changes: `BREAKING CHANGE: <descripción>`.
- Incluir co-author cuando aplique:
  ```
  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  ```
