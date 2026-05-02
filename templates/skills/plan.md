---
name: plan
description: Crea uno o varios work-items (feature, refactor, fix, chore) con sus tasks en GitHub. Devuelve la visión completa del lote. NO crea ramas — eso lo hace /apply.
---

# /plan

Planifica trabajo en GitHub. **Toda planificación se agrupa bajo work-items padre** (feature, refactor, fix o chore). Las tasks son las piezas concretas dentro de cada work-item.

`/plan` puede crear **uno o varios work-items en una sola invocación**: si lo que el dev describe abarca varios alcances independientes, se separan en work-items distintos para que el dev (o el equipo) los pueda tomar en paralelo. La salida es una **visión completa del lote** — todo lo que se va a hacer, con sus #IDs, antes de empezar a codear.

**Importante:** `/plan` **no crea ramas**. Las ramas se crean cuando alguien invoca `/apply` sobre un work-item específico — así se evita ensuciar el remote con ramas vacías y se permite que diferentes devs tomen distintos work-items.

## Cuándo invocar

Cuando el dev quiere planificar trabajo. Puede invocarse explícitamente o por intención textual:
"planifiquemos esto", "qué tareas necesitamos", "cómo lo dividimos", "tengo este bug a resolver", "tengo varias cosas que hacer", etc.

**Regla dura:** si el dev pide editar código sin tener un work-item asignado y `in-progress`, no se edita — primero pasa por `/plan`. Ver regla `no-edit-without-plan` en `CLAUDE.md`.

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
Plan (1 invocación de /plan)
  ├─ Work-item A (issue padre, label feature|refactor|fix|chore)
  │    ├─ Task A.1 (sub-issue)        → un commit cuando se cierre
  │    ├─ Task A.2 (sub-issue)
  │    └─ Task A.3 (sub-issue)
  │    Rama: <tipo>/<NA>-<slug>       ← creada por /apply, no por /plan
  │    PR:   uno solo, hacia dev      ← cuando todas las tasks cierran
  │
  ├─ Work-item B (independiente de A)
  │    └─ Task B.1
  │    Rama: <tipo>/<NB>-<slug>
  │
  └─ Work-item C
       └─ ...
```

**No se crean sub-sub-tasks.** Si una task necesita más profundidad, el work-item está mal dimensionado: divídelo en dos work-items.

## Flujo

### 0. Resolver credenciales de GitHub

```bash
source .claude/scripts/gh-isolated.sh || exit 1
```

### 1. Entender el scope completo

Preguntar al dev:
- ¿Qué quiere hacer? (descripción libre — puede mencionar varias cosas)
- ¿Qué repos afecta?

**Decidir si es un solo work-item o varios.**

**Default = 1 work-item.** Por defecto, una invocación de `/plan` produce **un solo work-item**. Esto es lo normal y lo que más se usa. Tener muchas tasks dentro **no es razón para partir** — un work-item con 8-10 tasks coherentes está bien y sigue siendo un único PR limpio al final.

**Solo crear varios work-items cuando los alcances son inconexos** entre sí, es decir, **no comparten contexto temático ni de código**. El criterio es **temático**, no de tamaño:

- ✅ **Inconexo (separar):** "rediseño de la vista de productos" + "pasarela de pagos con Stripe" → son dos áreas distintas del producto que no se cruzan. **Dos work-items.**
- ✅ **Inconexo (separar):** "onboarding de usuario" + "refresh token JWT" → uno es UX/flujo, el otro es auth/infra. **Dos work-items.**
- ❌ **Coherente (NO partir):** "vista de productos + filtros + buscador + paginación + ordenamiento" → todo gira alrededor de productos. **Un solo work-item con 5 tasks.**
- ❌ **Coherente (NO partir):** "endpoint + tests + docs + tipo TS del cliente" → todo es la misma feature. **Un work-item con tasks mixtas.**

**Regla mnemotécnica:** si un solo PR final tendría sentido para revisar el conjunto, es un solo work-item. Si el reviewer diría "esto deberían ser dos PRs porque no tienen nada que ver", son dos work-items.

**Tamaño nunca es criterio para partir por sí solo.** Si un tema coherente naturalmente requiere 12 tasks, está bien. Lo que sí hay que evitar es meter 5 tasks de "productos" + 5 tasks de "auth" en el mismo work-item, porque ahí los temas no se cruzan.

Si tienes duda y el dev mencionó múltiples áreas, **preguntar antes de asumir**:

```
Mencionaste dos cosas: "rediseño de productos" y "pasarela de pagos".
¿Lo trabajamos como…?
  1. Dos work-items separados (recomendado: temas distintos, PRs separados)
  2. Un solo work-item con tasks de ambos temas
```

Si el dev mencionó una sola cosa con muchas piezas internas → **un solo work-item**, no preguntar.

### 2. Inferir tipo de cada work-item

Por cada work-item identificado, inferir tipo del lenguaje del dev:
- "agregar / crear / implementar / integrar" → **feature**
- "mejorar / migrar / extraer / limpiar / reorganizar" → **refactor**
- "corregir / arreglar / no funciona / falla / bug" → **fix**
- "actualizar deps / configurar CI / mover tooling" → **chore**

Si hay duda, preguntar al dev por work-item.

### 3. Proponer el plan completo (lote de work-items + tasks)

Mostrar al dev la propuesta antes de crear nada. **Visión global** — todo lo que se va a hacer:

```
📋 Plan propuesto — 2 work-items
─────────────────────────────────────────
[FEATURE] #TBD — Sistema de pagos con Stripe
  ├─ #TBD — feat:     Webhook handler
  ├─ #TBD — feat:     Endpoint POST /payments/intent
  └─ #TBD — refactor: Extraer cálculo de impuestos
  Rama (futura): feature/<N>-sistema-pagos-stripe

[FIX] #TBD — Logout no cierra sesión
  ├─ #TBD — fix:      Limpiar refresh token al logout
  └─ #TBD — fix:      Redirigir a /login tras logout
  Rama (futura): fix/<N>-logout-no-cierra

Repos afectados: backend, frontend
─────────────────────────────────────────
¿Crear estos work-items en GitHub? [S/n]
  ℹ Las ramas se crean recién cuando alguien haga /apply sobre cada work-item.
```

Si el dev pide ajustes (mover tasks entre work-items, partir uno en dos, juntar dos en uno) → iterar el plan. **No crear nada hasta tener confirmación explícita.**

### 4. Crear cada work-item padre + sus tasks

Iterar sobre cada work-item del lote. Para cada uno:

#### 4a. Crear el work-item padre

```bash
TYPE="feature"   # o refactor, fix, chore — según lo decidido
PARENT_TITLE="Sistema de pagos con Stripe"

gh issue create \
  --title "[$(echo $TYPE | tr '[:lower:]' '[:upper:]')] $PARENT_TITLE" \
  --label "$TYPE" \
  --body "$(cat <<EOF
## Objetivo
[Qué resuelve este work-item]

## Tasks
- [ ] #TBD (se llenan en paso 4d)

## Criterios de aceptación
- [ ] [criterio 1]
- [ ] [criterio 2]

## Repos afectados
- repo-1
EOF
)"
```

Guardar el número devuelto como `PARENT_N` y el node ID como `PARENT_NODE_ID` (`gh issue view $PARENT_N --json id`).

#### 4b. Crear cada task vinculada al padre

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

#### 4c. Vincular cada task como sub-issue nativo

```bash
gh api graphql -f query='
mutation($parent: ID!, $child: ID!) {
  addSubIssue(input: { issueId: $parent, subIssueId: $child }) {
    subIssue { number }
  }
}' -f parent="$PARENT_NODE_ID" -f child="$TASK_NODE_ID"
```

#### 4d. Actualizar el body del padre con los números reales

```bash
gh issue edit $PARENT_N --body "...lista actualizada con #N1, #N2, #N3..."
```

#### 4e. Agregar work-item + tasks al GitHub Project

```bash
cat .claude/.workspace-version    # leer githubProject.number y .owner
gh project item-add <number> --owner <owner> --url <issue-url>
```

Agregar al Project es obligatorio para padre y tasks. Si falla, reportar y pedir al dev hacerlo manual.

### 5. Mostrar resumen final del lote

Visión global con #IDs reales y URLs:

```
✓ Plan creado — 2 work-items, 5 tasks en total

[FEATURE] #12 — Sistema de pagos con Stripe — <URL>
  ├─ #42 — feat:     Webhook handler — <URL>
  ├─ #43 — feat:     Endpoint /payments/intent — <URL>
  └─ #44 — refactor: Extraer cálculo de impuestos — <URL>
  Rama (futura): feature/12-sistema-pagos-stripe

[FIX] #18 — Logout no cierra sesión — <URL>
  ├─ #50 — fix:      Limpiar refresh token al logout — <URL>
  └─ #51 — fix:      Redirigir a /login tras logout — <URL>
  Rama (futura): fix/18-logout-no-cierra

Vinculados al GitHub Project: ✓
Ramas creadas: 0 (las crea /apply al arrancar cada work-item)
```

### 6. Preguntar si arrancar UN work-item del lote ahora

**Solo se arranca un work-item a la vez** — la rama del que se arranca se crea en `/apply`. Los demás quedan listos para que el mismo dev (en otra sesión) o un compañero los tomen.

```
¿Arrancamos algún work-item ahora?
  1. Sí, arrancar #12 (Sistema de pagos)
  2. Sí, arrancar #18 (Logout no cierra sesión)
  3. No, dejar el lote planificado y arrancar después con /init + /apply
```

Si el dev elige 1 o 2 → invocar `/apply` con el work-item elegido. **No crear la rama aquí** — es responsabilidad de `/apply` (incluye chequeo de ownership, asignación, label `in-progress`, creación de rama).

Si el dev elige 3 → el lote queda listo. Cualquier dev puede tomar uno con `/init` + `/apply` después.

## Agregar tasks durante el desarrollo

Es normal descubrir cosas a medio camino: un bug en una task ya cerrada, un detalle faltante, un refactor que aparece. **El patrón correcto es agregar la nueva task al mismo work-item padre** mientras esté abierto.

```bash
# Crear la task nueva como sub-issue del work-item activo
gh issue create --title "..." --label "task" --body "...\n\nWork-item padre\n#${PARENT_N}"
gh api graphql -f query='mutation($p: ID!, $c: ID!) { addSubIssue(input:{issueId:$p, subIssueId:$c}) { subIssue { number } } }' \
  -f p="$PARENT_NODE_ID" -f c="$NEW_TASK_NODE_ID"
gh project item-add <number> --owner <owner> --url <new-task-url>
```

**Regla:** si lo que descubriste es parte de cerrar BIEN lo que estás construyendo → nueva task en el mismo padre. Si es algo que ya estaba mergeado en producción y necesita su propio ciclo → nuevo work-item de tipo `fix` (puede planearse con un nuevo `/plan`).

## Buenas prácticas

- **Toda planificación = uno o varios work-items padre.** No hay tasks huérfanas.
- **Default 1 work-item por `/plan`.** Solo crear varios cuando los alcances son **temáticamente inconexos** entre sí. Tener muchas tasks coherentes no es razón para partir.
- **Un work-item con muchas tasks está bien** si todas giran alrededor del mismo tema. 8-12 tasks coherentes es normal. Lo que NO se hace es mezclar temas distintos en el mismo work-item solo porque "se pidieron juntos".
- **Tasks vinculadas nativamente** al padre vía `addSubIssue` (no solo referencia textual).
- **Subtareas internas** como checkboxes en el body de la task, NO como issues nuevos.
- **`/plan` no crea código ni ramas.** Solo issues, sub-issues y links al Project. Las ramas se crean cuando `/apply` arranca un work-item.
- **El tipo del work-item determina el prefijo de la rama** (`feature/`, `refactor/`, `fix/`, `chore/`).
- **Las tasks pueden mezclar tipos** internamente (feat, fix, refactor, test, docs) — eso se refleja en cada commit con Conventional Commits.

## Siguiente paso

- **Dev confirmó arrancar un work-item del lote** → `/apply` (toma ese work-item, crea la rama desde `dev`, marca primera task `in-progress`)
- **Dev no quiere arrancar aún** → el lote queda listo. La próxima vez `/init` lo lista junto con cualquier otro abierto.
- **Plan afecta múltiples repos** → `/cross` para coordinar cambios cross-repo
- **Hay drift entre código y plan en GitHub** → `/sync` antes de `/apply`
