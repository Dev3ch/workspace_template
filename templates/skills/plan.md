---
name: plan
description: Crea un work-item (feature, refactor, fix, chore) con sus tasks en GitHub y prepara la rama. Toda planificación va bajo un work-item.
---

# /plan

Planifica trabajo en GitHub. **Toda planificación se agrupa bajo un work-item padre** (feature, refactor, fix, o chore). Las tasks son las piezas concretas dentro de ese work-item.

## Cuándo invocar

Cuando el dev quiere planificar trabajo. Puede invocarse explícitamente o por intención textual:
"planifiquemos esto", "qué tareas necesitamos", "cómo lo dividimos", "tengo este bug a resolver", etc.

## Tipos de work-item

| Tipo | Cuándo usarlo | Label | Prefijo de rama |
|---|---|---|---|
| **feature** | Funcionalidad nueva | `feature` | `feature/<N>-<slug>` |
| **refactor** | Mejorar código sin cambiar comportamiento | `refactor` | `refactor/<N>-<slug>` |
| **fix** | Corregir un bug o comportamiento incorrecto | `fix` | `fix/<N>-<slug>` |
| **chore** | Mantenimiento técnico (deps, CI, tooling) | `chore` | `chore/<N>-<slug>` |

Las **tasks** dentro de cualquier work-item pueden ser de tipos mixtos (feat, refactor, test, docs, fix) — el tipo de la task se refleja en su mensaje de commit (Conventional Commits).

## Modelo de trabajo

```
Work-item (issue padre, label feature|refactor|fix|chore)
  ├─ Task (issue hijo, vinculado nativamente)        → un commit cuando se cierre
  │    └─ Subtarea (checkbox en el body)             → detalle interno, NO un issue
  ├─ Task
  └─ Task

Rama: <tipo>/<N>-<slug>     ← una rama por work-item
PR:   uno solo, al cerrar el work-item, hacia dev
```

**No se crean sub-sub-tasks.** Si necesitas más profundidad, el work-item está mal dimensionado: divídelo en dos work-items.

## Flujo

### 0. Resolver credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

### 1. Entender el scope y elegir tipo

Preguntar al dev:
- ¿Qué quiere hacer? (descripción libre)
- ¿Qué repos afecta?

Inferir el tipo del work-item del lenguaje del dev:
- "agregar / crear / implementar / integrar" → **feature**
- "mejorar / migrar / extraer / limpiar / reorganizar" → **refactor**
- "corregir / arreglar / no funciona / falla / bug" → **fix**
- "actualizar deps / configurar CI / mover tooling" → **chore**

Si hay duda, preguntar al dev qué tipo es.

### 2. Proponer el plan completo (work-item + tasks)

Mostrar al dev la propuesta antes de crear nada:

```
📋 Plan propuesto:
─────────────────────────────────────────
[FEATURE] #TBD — Sistema de pagos con Stripe
  ├─ #TBD — feat:     Webhook handler
  ├─ #TBD — feat:     Endpoint POST /payments/intent
  ├─ #TBD — refactor: Extraer cálculo de impuestos
  └─ #TBD — test:     Tests de integración

Repos afectados: backend
Rama de trabajo: feature/<N>-sistema-pagos-stripe
─────────────────────────────────────────
¿Crear estos issues? [S/n]
```

Si el dev pide ajustes → iterar el plan. **No crear nada hasta tener confirmación explícita.**

### 3. Crear el work-item padre

```bash
TYPE="feature"   # o refactor, fix, chore — según lo decidido en el paso 1
PARENT_TITLE="Sistema de pagos con Stripe"

gh issue create \
  --title "[$(echo $TYPE | tr '[:lower:]' '[:upper:]')] $PARENT_TITLE" \
  --label "$TYPE" \
  --body "$(cat <<EOF
## Objetivo
[Qué resuelve este work-item]

## Tasks
- [ ] #TBD (se llenan en paso 5)

## Criterios de aceptación
- [ ] [criterio 1]
- [ ] [criterio 2]

## Repos afectados
- repo-1
EOF
)"
```

Guardar el número devuelto como `PARENT_N` y el node ID como `PARENT_NODE_ID` (usar `gh issue view $PARENT_N --json id`).

### 4. Crear cada task vinculada al padre

```bash
gh issue create \
  --title "Descripción concreta de la task" \
  --label "task" \
  --body "$(cat <<EOF
## Descripción
[Qué hay que implementar / refactorizar / arreglar]

## Subtareas
- [ ] [subtarea 1]
- [ ] [subtarea 2]

## Criterios de aceptación
- [ ] [criterio 1]

## Tipo de cambio (Conventional Commits)
feat | fix | refactor | test | docs | chore | perf

## Notas técnicas
[Endpoint, modelo, archivo afectado, etc.]

## Work-item padre
#${PARENT_N}
EOF
)"
```

Vincular cada task como sub-issue nativo del padre vía GraphQL:

```bash
gh api graphql -f query='
mutation($parent: ID!, $child: ID!) {
  addSubIssue(input: { issueId: $parent, subIssueId: $child }) {
    subIssue { number }
  }
}' -f parent="$PARENT_NODE_ID" -f child="$TASK_NODE_ID"
```

### 5. Agregar work-item + tasks al GitHub Project

```bash
cat .claude/.workspace-version    # leer githubProject.number y .owner
gh project item-add <number> --owner <owner> --url <issue-url>
```

Agregar al Project es obligatorio. Si falla, reportar y pedir al dev hacerlo manual.

### 6. Actualizar el body del padre con los números reales

```bash
gh issue edit $PARENT_N --body "...lista actualizada con #N1, #N2, #N3..."
```

### 7. Mostrar resumen final

```
✓ Plan creado:
  [FEATURE] #12 — Sistema de pagos — <URL>
    ├─ #42 — feat:     Webhook handler — <URL>
    ├─ #43 — feat:     Endpoint /payments/intent — <URL>
    └─ #44 — refactor: Extraer cálculo de impuestos — <URL>

  Vinculados al Project: ✓
```

### 8. Preguntar si arrancar el work-item ahora

```
¿Arrancamos este work-item ahora? [S/n]
```

Si el dev dice **sí** → crear la rama desde `dev`:

```bash
SLUG="sistema-pagos-stripe"
BRANCH="${TYPE}/${PARENT_N}-${SLUG}"

git fetch origin --prune
git checkout dev && git pull --ff-only origin dev
git checkout -b "$BRANCH"
git push -u origin "$BRANCH"
```

Marcar el work-item y la primera task como `in-progress`:

```bash
gh issue edit $PARENT_N --add-assignee @me --add-label "in-progress"
gh issue edit $FIRST_TASK_N --add-assignee @me --add-label "in-progress"
```

Si el dev dice **no** → el plan queda listo. La rama se creará cuando invoque `/apply`.

## Agregar tasks durante el desarrollo

Es normal descubrir cosas a medio camino: un bug en una task ya cerrada, un detalle faltante, un refactor que aparece. **El patrón correcto es agregar la nueva task al mismo work-item padre** mientras esté abierto.

```bash
# Crear la task nueva como sub-issue del work-item activo
gh issue create --title "..." --label "task" --body "...\n\nWork-item padre\n#${PARENT_N}"
gh api graphql -f query='mutation($p: ID!, $c: ID!) { addSubIssue(input:{issueId:$p, subIssueId:$c}) { subIssue { number } } }' \
  -f p="$PARENT_NODE_ID" -f c="$NEW_TASK_NODE_ID"
gh project item-add <number> --owner <owner> --url <new-task-url>
```

**Regla:** si lo que descubriste es parte de cerrar BIEN lo que estás construyendo → nueva task en el mismo padre. Si es algo que ya estaba mergeado en producción y necesita su propio ciclo → nuevo work-item de tipo `fix`.

## Buenas prácticas

- **Toda planificación = un work-item padre.** No hay tasks huérfanas.
- **Una work-item = N tasks** (sin límite estricto, pero si llega a 15+ probablemente hay que dividir).
- **Tasks vinculadas nativamente** al padre vía `addSubIssue` (no solo referencia textual).
- **Subtareas internas** como checkboxes en el body de la task, NO como issues nuevos.
- **Nunca crear código antes de** que el work-item exista, sus tasks estén creadas, y el dev haya confirmado.
- **El tipo del work-item determina el prefijo de la rama** (`feature/`, `refactor/`, `fix/`, `chore/`).
- **Las tasks pueden mezclar tipos** internamente (feat, fix, refactor, test, docs) — eso se refleja en cada commit con Conventional Commits.

## Siguiente paso

- **Dev confirmó arrancar** → `/apply` trabaja sobre la rama `<tipo>/<N>-<slug>`
- **Dev no quiere arrancar aún** → el plan queda listo, `/apply` creará la rama después
- **Plan afecta múltiples repos** → `/cross` para coordinar cambios cross-repo
- **Hay drift entre código y plan en GitHub** → `/sync` antes de `/apply`
