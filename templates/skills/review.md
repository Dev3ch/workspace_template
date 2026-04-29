---
name: review
description: Code review del PR con perspectiva fresca. Usar antes de mergear.
---

# /review

Revisa código con perspectiva fresca. Ideal para revisar PRs o validar implementaciones.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

- Antes de mergear un PR.
- Después de implementar una feature compleja.
- Para validar que un cambio de API no rompe contratos cross-repo.

## Flujo

### 1. Obtener el diff

Si se pasa un PR:
```bash
gh pr view <N> --json title,body,headRefName,files,url
gh pr diff <N>
```

Si es el branch actual:
```bash
git diff dev...HEAD --stat
git diff dev...HEAD
```

### 2. Revisar contexto del issue

```bash
gh issue view <N> --json title,body
```

### 3. Checklist de revisión

**Correctitud:**
- [ ] La implementación cumple todos los criterios de aceptación del issue.
- [ ] No hay casos edge sin manejar.
- [ ] Los errores se manejan correctamente (no silenciados).

**Tests:**
- [ ] Hay tests para el happy path.
- [ ] Hay tests para validation errors.
- [ ] Hay tests para auth (403 para usuario sin permiso).
- [ ] Los tests son independientes y no comparten estado mutable.

**Seguridad:**
- [ ] No hay secrets en el código.
- [ ] Los endpoints nuevos validan autenticación y autorización.
- [ ] No hay SQL injection posible (se usa ORM o queries parametrizadas).
- [ ] Multi-tenant: los queries filtran por organización.

**API contracts (cross-repo):**
- [ ] Si se modificó un endpoint, el frontend / consumidor fue actualizado.
- [ ] Los tipos/schemas coinciden entre productor y consumidor.

**Calidad:**
- [ ] Sin `console.log` o `print()` olvidados.
- [ ] Nombres descriptivos (sin variables `x`, `temp`, `data2`).
- [ ] Sin código comentado que debería eliminarse.
- [ ] Sin TODOs sin issue asociado.

**CLAUDE.md:**
- [ ] Si se aprendió algo nuevo, se actualizó el `CLAUDE.md` correspondiente.

### 4. Output

Listar findings por severidad:
- **Bloqueante:** debe corregirse antes del merge.
- **Mejora:** recomendable pero no bloquea.
- **Sugerencia:** opcional, cosmético.

Si todo está bien: aprobar con un resumen de lo revisado.

## Siguiente paso

- **Todo verde, listo para mergear a dev** → merge → `/build` paso 8 (cierre automático del work-item + tasks pendientes + limpieza de rama)
- **Bloqueantes detectados** → `/apply` (o `/debug`) para corregirlos → volver a `/review`
- **Cambio toca autenticación, pagos o datos sensibles** → `/audit` antes del merge
- **Rama va directo a main** → `/secure` + `/deploy` tras el merge

## Tras el merge

Una vez mergeado el PR, **no dejar issues en `in-progress` ni el work-item abierto**. El cierre es automático (ver `/build` paso 8): cerrar el work-item padre, cerrar cualquier task colgante referenciando el PR, quitar labels intermedios, y ofrecer borrar la rama. Nunca decirle al dev "voy a cerrar los issues manualmente" — es trabajo del flujo.

## Notas

- Revisar siempre con contexto del issue, no solo el diff.
- En cambios cross-repo, revisar ambos lados del contrato API.
- Esta skill debe usarse idealmente en una sesión Claude fresca (sin contexto de quien escribió el código).
