---
name: sync
description: Detecta drift entre código real y plan en GitHub. Reconcilia issues.
---

# /sync

Detecta drift entre el código real y el plan en GitHub. Reconcilia issues resueltos indirectamente, duplicados o desactualizados.

## Credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

- Cuando dos devs trabajan en paralelo y puede haber solapamiento.
- Antes de empezar una nueva tarea (después de `/init`) si el repo tiene actividad reciente de otros.
- Cuando un issue parece ya resuelto pero sigue abierto.
- Cuando el plan en GitHub no refleja el estado real del código.

## Pasos

### 1. Leer el estado real del repo

```bash
# Commits recientes de todos los autores
git log --oneline --all --since="7 days ago" --format="%h %an %s"

# Archivos modificados recientemente
git diff --name-only HEAD~10 HEAD

# Ramas activas
git branch -a --sort=-committerdate | head -20
```

### 2. Leer el plan en GitHub

```bash
# Todos los issues abiertos con sus labels
gh issue list --state open --json number,title,labels,assignee,body,url \
  --jq '.[] | {number, title, assignee: .assignee.login, labels: [.labels[].name]}'

# PRs abiertos
gh pr list --state open --json number,title,headRefName,author,url
```

### 3. Comparar código vs issues abiertos

Para cada issue abierto, verificar si el código ya lo resuelve:

```bash
# Buscar referencias al issue en commits
git log --all --oneline --grep="#<N>" 2>&1

# Buscar la funcionalidad del issue en el código
grep -rn "<keyword-del-issue>" --include="*.py" --include="*.ts" --include="*.go" \
  --exclude-dir=node_modules --exclude-dir=.git . | head -20
```

### 4. Clasificar cada issue

| Estado detectado | Acción |
|---|---|
| **Resuelto en código, issue abierto** | Cerrar el issue con referencia al commit |
| **Parcialmente resuelto** | Actualizar el body con lo que falta, agregar comment |
| **Duplicado de otro issue** | Cerrar como duplicado, referenciar el original |
| **Bloqueado por otro** | Agregar label `blocked`, referenciar el bloqueante |
| **Plan desactualizado** | Actualizar el body del issue con el estado real |
| **Asignado pero sin actividad > 5 días** | Comentar para verificar si sigue activo |

### 5. Ejecutar acciones de reconciliación

```bash
# Cerrar issue resuelto indirectamente
gh issue close <N> --comment "Resuelto indirectamente en <commit-hash> por @<autor>.
El código en <archivo>:<línea> cubre este caso."

# Actualizar issue parcialmente resuelto
gh issue comment <N> --body "### Actualización /sync — $(date +%Y-%m-%d)

**Estado real del código:**
- ✓ <parte ya implementada>
- ✗ <parte pendiente>

**Pendiente:**
- [ ] <tarea concreta que falta>"

# Marcar duplicado
gh issue close <N> --comment "Duplicado de #<M>. Consolidar trabajo ahí." \
  --reason "not planned"
```

### 6. Verificar solapamiento entre devs

```bash
# Archivos tocados por ramas diferentes simultáneamente
git diff --name-only origin/feat/issue-<N1>...origin/feat/issue-<N2> 2>/dev/null
```

Si hay solapamiento en los mismos archivos, notificar a ambos devs con un comment en cada issue.

### 7. Generar reporte de sincronización

```
=== /sync — Reporte ===
Período analizado: últimos 7 días
Issues abiertos: 12
Commits recientes: 34

Acciones tomadas:
  ✓ Issue #15 cerrado — resuelto indirectamente en a3f2b1c por @dev-b
  ✓ Issue #18 actualizado — 2 de 4 sub-tareas ya implementadas
  ⚠  Issue #21 y #23 se solapan en auth/middleware.py — avisar a @dev-a y @dev-b
  ⚠  Issue #9 sin actividad por 6 días — asignado a @dev-c

Backlog limpio: 9 issues activos (antes 12)
```

## Siguiente paso

- **Backlog limpio, puedes seguir con tu tarea** → `/apply` o `/plan`
- **Detectaste solapamiento en archivos** → comunicar con el otro dev antes de `/apply`
- **Muchos issues desactualizados** → `/triage` para limpieza profunda en bulk
- **Hay issues bloqueados** → `/plan` para resolver dependencias primero

## Notas

- No cerrar issues sin dejar un comment explicando por qué.
- Si hay solapamiento crítico (mismo archivo, lógica contradictoria), crear un issue de coordinación antes de continuar.
- `/sync` no modifica código — solo el estado de GitHub. Para cambios de código usar `/apply`.
- Correr `/sync` antes de cada `/plan` en equipos de más de una persona.
