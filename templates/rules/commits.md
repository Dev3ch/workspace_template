# Commits

## Formato

Conventional Commits enforced por commitlint. **Cada commit corresponde a una task cerrada de un work-item**.

```
<tipo>(<scope>): <description> (#<task-N>) — <tipo-padre> #<parent-N>
```

**Header máximo 100 caracteres.**

- `<tipo>` = tipo de la task (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`).
- `<scope>` = módulo o área afectada (`auth`, `api`, `payments`, `ui`, `db`, etc.).
- `<task-N>` = número del issue de la task que se cierra con este commit.
- `<tipo-padre>` = tipo del work-item padre (`feature`, `refactor`, `fix`, `chore`).
- `<parent-N>` = número del work-item padre.

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

## Ejemplos correctos

```
feat(payments): webhook handler de Stripe (#42) — feature #12
feat(payments): endpoint POST /payments/intent (#43) — feature #12
refactor(payments): extraer cálculo de impuestos (#44) — feature #12
test(payments): tests de integración del flujo (#45) — feature #12

refactor(auth): eliminar JWT helper obsoleto (#50) — refactor #15
fix(api): null organization_id en invoice list (#58) — fix #18
chore(deps): bump next.js a 16.2.0 (#60) — chore #20
```

Para hotfixes urgentes en producción (rama `hotfix/*`, sin work-item padre):
```
hotfix(api): patch race condition en webhook #80
```

## Ejemplos incorrectos

```
fix: stuff                              ← sin scope ni referencia
updated things                          ← no es conventional
feat(auth): Add JWT Token (#42)         ← mayúscula en descripción
feat(auth): add JWT token. (#42)        ← punto al final
feat: webhook handler (#42)             ← sin scope
feat(payments): webhook (#42)           ← falta referencia al work-item padre
```

## Reglas adicionales

- **Un commit = una task cerrada.** No mezclar cambios de varias tasks en el mismo commit.
- Cuerpo del commit (body) opcional, separado por línea en blanco.
- Footer para breaking changes: `BREAKING CHANGE: <descripción>`.
- Incluir co-author cuando aplique:
  ```
  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  ```
