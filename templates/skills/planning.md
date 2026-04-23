# /planning

Planifica y crea issues en GitHub — features nuevas, epics, o descompone un epic en sub-issues.

## Cuándo invocar

Cuando el dev quiere planificar una feature nueva, crear un epic, o desglosar trabajo en tareas concretas.

## Flujo

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

### 4. Agregar al GitHub Project

```bash
# Obtener el número del project
gh project list --owner <owner>

# Agregar issue al project
gh project item-add <project-number> --owner <owner> --url <issue-url>
```

### 5. Linkear sub-issues al epic

Editar el body del epic para incluir los números de los sub-issues creados.

### 6. Mostrar resumen

Listar todos los issues creados con sus URLs y el plan de implementación ordenado por dependencias.

## Buenas prácticas

- Un issue = una tarea que puede cerrarse en 1-2 sesiones.
- Los criterios de aceptación deben ser verificables (checkbox).
- Siempre especificar qué repos afecta cada issue.
- Priorizar: ¿qué bloquea a qué?
