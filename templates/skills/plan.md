---
name: plan
description: Crea issues, epics y sub-issues en GitHub. Usar para planificar features.
---

# /plan

Planifica y crea issues en GitHub — features nuevas, epics, o descompone un epic en sub-issues.

## Cuándo invocar

Cuando el dev quiere planificar una feature nueva, crear un epic, o desglosar trabajo en tareas concretas.

## Flujo

### 0. Resolver credenciales de GitHub

```bash
source .claude/scripts/resolve-gh-creds.sh || exit 1
```

### 1. Entender el scope

Preguntar al dev:
- ¿Qué quieres implementar?
- ¿Es una feature pequeña (< 1 día) o un epic (varios días / semanas)?
- ¿Qué repos afecta?

### 2. Para un epic

Crear el issue padre:
```bash
gh issue create \
  --title "[EPIC] Nombre del epic" \
  --label "epic" \
  --body "$(cat <<'EOF'
## Objetivo
[Qué problema resuelve este epic]

## Sub-issues
- [ ] #TBD

## Criterios de aceptación
- [ ] [criterio 1]
- [ ] [criterio 2]

## Repos afectados
- repo-1
- repo-2
EOF
)"
```

### 3. Para cada sub-issue / feature

```bash
gh issue create \
  --title "[FEAT] Descripción concreta" \
  --label "feature" \
  --body "$(cat <<'EOF'
## Descripción
[Qué hay que implementar]

## Criterios de aceptación
- [ ] [criterio 1]
- [ ] [criterio 2]

## Repos afectados
- repo-1

## Notas técnicas
[Endpoint a crear, modelo a modificar, etc.]

## Issue padre
Epic: #N
EOF
)"
```

### 4. Mostrar resumen y pedir confirmación

Antes de crear cualquier issue, mostrar al dev el plan completo:

```
📋 Plan propuesto:
─────────────────────────────────────────
[EPIC] Nombre del epic  (si aplica)
  └─ [FEAT] Sub-issue 1 — descripción
  └─ [FEAT] Sub-issue 2 — descripción
  └─ [FEAT] Sub-issue 3 — descripción
─────────────────────────────────────────
¿Crear estos issues? [S/n]
```

Si el dev dice que no → ajustar el plan antes de continuar. No crear nada hasta tener confirmación.

### 6. Agregar al GitHub Project

Leer la configuración del Project guardada en este workspace:
```bash
cat .claude/.workspace-version
```

El campo `githubProject` contiene `number`, `owner` y `url`. Usar esos valores directamente.
Si el campo no existe, preguntar al dev el número del Project antes de continuar y sugerirle que ejecute `npx workspace-template` para configurarlo.

Agregar cada issue al Project **inmediatamente** después de crearlo:
```bash
gh project item-add <number> --owner <owner> --url <issue-url>
```

**Importante:** Vincular al Project es obligatorio, no opcional. Si falla, reportar el error y pedir al dev que lo haga manualmente con el comando de arriba.

### 7. Linkear sub-issues al epic

Editar el body del epic para incluir los números de los sub-issues creados.

### 8. Mostrar resumen de issues creados

Listar todos los issues creados con sus URLs y el plan de implementación ordenado por dependencias.

### 9. Preguntar si arrancar con el primer issue

```
¿Quieres arrancar con el issue #N ahora? [S/n]
```

Si el dev dice **sí** → crear la rama de trabajo desde `dev` inmediatamente:

```bash
git fetch origin --prune
git checkout dev && git pull --ff-only origin dev
git checkout -b feat/issue-<N>-<slug-del-titulo>
git push -u origin feat/issue-<N>-<slug-del-titulo>
echo "✓ Rama feat/issue-<N>-<slug-del-titulo> creada y pusheada"
```

Asignar el issue al dev y agregar label `in-progress`:
```bash
gh issue edit <N> --add-assignee @me
gh issue edit <N> --add-label "in-progress"
```

Si el dev dice **no** → el plan queda listo para cuando quiera arrancar con `/apply`.

## Buenas prácticas

- Un issue = una tarea que puede cerrarse en 1-2 sesiones.
- Los criterios de aceptación deben ser verificables (checkbox).
- Siempre especificar qué repos afecta cada issue.
- Priorizar: ¿qué bloquea a qué?
- **Nunca crear código antes de que el issue exista y esté confirmado.**

## Siguiente paso

- **Dev dijo sí al arrancar** → `/apply` (la rama ya existe, implementar directo)
- **Dev dijo no por ahora** → `/apply` cuando quiera empezar (creará la rama en ese momento)
- **Plan afecta múltiples repos** → `/cross` (coordinar cambios cross-repo)
- **Trabajan otros devs y puede haber drift** → `/sync` antes de `/apply`
- **Epic grande con sub-issues** → `/apply` por cada sub-issue en orden de dependencias
