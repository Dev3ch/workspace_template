---
name: rollback
description: Revierte el último deploy de forma segura y crea issue de post-mortem.
---

# /rollback

Revierte el último deploy de forma segura: identifica qué se deployó, deshace los cambios y vuelve a publicar el estado anterior.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

- Cuando un deploy a producción introduce un error crítico.
- Cuando las métricas de la app caen después de un deploy.
- Cuando se necesita volver a un estado estable mientras se corrige el bug.

## Pasos

### 1. Evaluar la urgencia

Antes de hacer cualquier cosa, determinar el impacto:

```
¿Está caído el servicio completamente?   → rollback inmediato (saltar al paso 3)
¿Hay degradación parcial?                → investigar primero (paso 2)
¿Es un bug menor no crítico?             → crear issue, no hacer rollback
```

### 2. Identificar qué se deployó

```bash
# Último commit en main
git log origin/main --oneline -10

# Diferencia entre el commit actual y el anterior
git diff HEAD~1..HEAD --stat
git diff HEAD~1..HEAD

# Si hay tags de release
git tag --sort=-creatordate | head -5
git show <tag-anterior>
```

### 3. Verificar el estado del proveedor de deploy

```bash
# Vercel — listar deployments recientes
npx vercel ls --limit 5

# Fly.io
flyctl releases list --limit 5

# Railway
npx @railway/cli status
```

### 4a. Rollback instantáneo en el proveedor (más rápido)

**Vercel:**
```bash
# Promover el deployment anterior a producción
npx vercel rollback
```

**Fly.io:**
```bash
# Ver releases
flyctl releases list
# Rollback a versión anterior
flyctl deploy --image <imagen-anterior>
```

**Railway:**
```bash
# Desde el dashboard o CLI
npx @railway/cli rollback
```

### 4b. Rollback por Git (si no hay opción en el proveedor)

```bash
# Crear rama de rollback desde el commit estable
git checkout -b hotfix/rollback-to-<commit-hash> <commit-hash>

# O revertir el último commit con un commit nuevo (no destructivo)
git revert HEAD --no-edit
git push origin main

# Esto dispara el workflow de deploy automáticamente
```

### 5. Verificar que el rollback fue exitoso

```bash
# Verificar que el servicio responde
curl -I https://<tu-dominio>.com

# Verificar la versión deployada
curl https://<tu-dominio>.com/api/health
# o
curl https://<tu-dominio>.com/api/version
```

### 6. Crear issue de post-mortem

```bash
gh issue create \
  --title "Post-mortem: rollback deploy $(date +%Y-%m-%d)" \
  --body "### Rollback ejecutado

**Fecha:** $(date)
**Commit revertido:** $(git log --oneline -1)
**Tiempo de impacto:** <estimar>

### Causa
<describir qué salió mal>

### Acciones tomadas
- [ ] Rollback ejecutado
- [ ] Servicio verificado y estable
- [ ] Bug identificado
- [ ] Fix en progreso (ver #<N>)
- [ ] Deploy del fix
- [ ] Post-mortem completado

### Cómo evitarlo
<medidas preventivas>" \
  --label "incident,high-priority"
```

### 7. Proteger main mientras se corrige

```bash
# Crear rama de fix desde el commit estable (no desde main roto)
git checkout -b hotfix/issue-<N>-fix <commit-hash-estable>
```

El fix sigue el flujo: `/apply` → `/test` → `/secure` → `/deploy`

## Output esperado

```
=== /rollback ejecutado ===

Commit revertido: a3f2b1c — feat(payments): add Stripe webhook
Rollback a:       9e1d4f2 — feat(auth): add JWT refresh (hace 2 días)

Proveedor: Vercel
Estado:    ✓ Deployment anterior promovido a producción
Verificación: ✓ https://mi-app.com responde 200

Issue creado: #67 — Post-mortem: rollback deploy 2025-04-23
Rama de fix:  hotfix/issue-65-stripe-webhook-fix

Próximo paso: /apply en hotfix/issue-65-stripe-webhook-fix
```

## Siguiente paso

- **Servicio estable de nuevo** → `/debug` en rama `hotfix/*` para encontrar causa raíz
- **Causa raíz identificada** → `/apply` → `/test` → `/secure` → `/deploy` (flujo urgente)
- **Rollback no resolvió el problema** → escalar inmediatamente al equipo
- **Incidente importante** → actualizar el `CLAUDE.md` con la lección aprendida

## Notas

- Siempre preferir el rollback del proveedor (opción 4a) sobre el rollback de Git — es más rápido y no genera commits extra.
- Nunca hacer `git reset --hard` en `main` — usar `git revert` para mantener el historial.
- Un rollback es temporal — el bug debe corregirse en una rama `hotfix/*` y pasar por el flujo completo antes de volver a deployar.
- Documentar siempre el incidente en un issue, aunque sea pequeño.
