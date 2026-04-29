# workspace-template

Convierte cualquier proyecto en un workspace de **Claude Code** con flujo de trabajo profesional listo para usar.

```bash
npx workspace-template
```

Sin clonar, sin configurar nada antes.

---

## Qué te da

- **Flujo work-item / tasks**: planifica, implementa y lanzas PRs siguiendo un patrón estándar (estilo Linear / Vercel).
- **Skills de Claude Code**: comandos como `/init`, `/plan`, `/apply`, `/build`, `/review` que automatizan el ciclo completo.
- **Modelo de branches**: `main` + `dev` (obligatoria) + `staging` (opcional), creadas y normalizadas por el CLI.
- **Integración con GitHub**: issues, sub-issues nativos, PRs, GitHub Projects — todo conectado.
- **Conventional Commits** + drift detection automático contra `dev`.
- **Single-repo o multi-repo** indistintamente.

## Inicio rápido

**Sin Node.js instalado:**
```bash
curl -fsSL https://raw.githubusercontent.com/Dev3ch/workspace_template/main/setup.sh | bash
```

**Con Node.js:**
```bash
npx workspace-template
```

El CLI te guía paso a paso (en español).

## Cómo funciona — en 30 segundos

Hay tres niveles de uso. Empieza por el básico.

### Flujo básico (el 80% del tiempo)

```
/init  →  /plan  →  /apply  →  /build  →  (review en GitHub)  →  merge
```

- **`/init`** — arranca la sesión. Te pone en `dev`, lista tus work-items pendientes y te pregunta qué quieres hacer.
- **`/plan`** — propone un work-item (feature / refactor / fix / chore) con sus tasks. **Pide confirmación** antes de crear nada en GitHub.
- **`/apply`** — implementa la task activa, corre tests.
- **`/build`** — commit + push (con tu confirmación) por cada task. Cuando todas las tasks del work-item están cerradas, abre **un solo PR** hacia `dev`.

Tras el merge, `/build` cierra el work-item, sus tasks colgantes y limpia la rama — todo automático. Para la siguiente sesión arrancas con `/init` de nuevo.

**Conversacional:** no necesitas escribir los slash commands literalmente. Si dices "planifiquemos un sistema de notificaciones" o "vamos a aplicar la siguiente task", Claude interpreta y avanza solo.

### Ejemplo real paso a paso

> **Escenario:** agregar un endpoint `GET /users` con paginación.

---

**`/init`**

**Claude:** Encontré 3 issues abiertos: `#8 fix login`, `#9 add pagination`, `#11 refactor auth`. ¿Trabajamos sobre alguno o tienes algo nuevo?

**User:** Tengo algo nuevo.

---

**`/plan`**

**User:** Quiero un endpoint `GET /users` con paginación.

**Claude:** Voy a crear en GitHub:
- Work-item padre: `feat: paginated users endpoint`
- Sub-issue #1: Crear ruta `GET /users?page&limit`
- Sub-issue #2: Query con offset a la DB
- Sub-issue #3: Respuesta `{ data, total, page }`

¿Creo estos issues?

**User:** Sí.

*Claude crea el work-item #15 y los sub-issues #16, #17, #18 en GitHub.*

---

**`/apply`**

**Claude:** ¿Aplico el plan? Cada sub-issue será un commit.

**User:** Sí.

*Claude implementa #16 → commit `feat: add GET /users route`*
*Claude implementa #17 → commit `feat: db query with pagination`*
*Claude implementa #18 → commit `feat: paginated response format`*

**Claude:** 3 commits listos en rama `feature/15-paginated-users`. ¿Corro el build?

---

**`/build`**

**User:** Sí.

*Claude corre `npm run test`*

**Claude:** ✓ 24 tests pasando. ¿Abro el PR hacia `dev`?

**User:** Sí.

*Claude crea PR #19: `feat: GET /users with pagination` → `dev`, closes #16 #17 #18, linked a #15.*

**Claude:** PR listo → [#19](../../pull/19). ¿Cómo quieres cerrar este PR?

```
1. Dejar para review del equipo  (default)
2. Mergearlo yo mismo ahora      (squash + delete branch)
3. Auto-merge cuando pasen los checks
4. Asignar reviewer específico
```

**User:** 1, déjalo para review.

**Claude:** Hecho. Tu trabajo aquí terminó. Cuando otra persona apruebe y mergee, en la próxima `/init` cierro el work-item, las tasks colgantes y te ofrezco borrar la rama.

---

**Review en GitHub → merge a `dev` ✓**

**Próxima `/init` o `/build` (post-merge):**

*Claude detecta que PR #19 fue mergeado.*

**Claude:**
- Cerré work-item #15 y tasks #16 #17 #18 referenciando el merge.
- Quité los labels `in-progress` y `review`.
- ¿Borro la rama local y remota `feature/15-paginated-users`?

**User:** Sí.

*Rama eliminada. Board limpio.* ✓

---

### Segundo ejemplo: drift contra `dev` en mitad del trabajo

Caso menos obvio: estás en una rama de feature, pero en `dev` se mergeó algo después de que arrancaste. `/apply` o `/build` lo detectan **antes** de dejarte commitear.

---

**Estás en `feature/15-paginated-users`, vas por la task #17.**

**`/apply`**

**Claude:** Antes de implementar — detecté que `dev` tiene 4 commits nuevos que no están en tu rama:

```
feat(auth): refresh token rotation
fix(users): null check en serializer
chore(deps): bump fastapi 0.115
refactor(db): pool de conexiones
```

Tu rama puede tener conflictos al abrir el PR. Opciones:

```
1. Rebasear contra dev ahora               (recomendado si los cambios son de tu zona)
2. Mergear dev en tu rama                  (preserva commits originales, deja merge commit)
3. Continuar y resolver al abrir el PR     (más riesgoso)
4. Cancelar y revisar manualmente
```

**User:** 1.

*Claude rebasea. Hay conflicto en `apps/users/serializer.py`.*

**Claude:** Conflicto en `apps/users/serializer.py:42`. El cambio de `fix(users): null check` toca el mismo serializer que tu task. ¿Lo resuelvo?

```
1. Ver el diff y resolver con tu input
2. Quedarte con dev y reescribir tu cambio encima  (riesgo: pierdes lógica)
3. Quedarte con tu rama y rechazar el cambio de dev (riesgo: regresión del fix)
4. Cancelar el rebase
```

**User:** 1.

*Claude muestra ambos lados, propone fusión que mantiene el null check + tu paginación, espera OK.*

**User:** Aplica.

*Rebase completo, sin conflictos pendientes. Tests siguen verdes.*

**Claude:** Rebase OK. Ahora sí, ¿implemento la task #17?

---

Esto es lo que hace que el flujo no se rompa cuando trabajas en paralelo con un equipo: drift detection automático en `/init`, `/apply` y `/build`, y nunca usa `reset --hard` para resolver. El detalle del flujo completo y todos los comandos están en [docs/flujo-arquitectura.md](docs/flujo-arquitectura.md).

---

### ¿Y si quiero pasar esto a producción?

Una vez que está en `dev` y quieres pase a producción, el flujo es `/secure` → `/deploy`. Si producción ya existe y está sana, `/deploy` lo detecta y no reconfigura nada — solo confirma. Si es la primera vez, crea un work-item con tasks por componente (Dockerfile, workflow, secrets, primer deploy) que trabajas con `/apply` como cualquier otro work-item.

Ver [docs/flujo-arquitectura.md](docs/flujo-arquitectura.md#skills-generadores-cuándo-crean-work-item-y-cuándo-no) para el detalle.

---

## Comandos disponibles

| Etapa | Comando | Para qué |
|---|---|---|
| Arrancar | [`/init`](templates/skills/init.md) | Lee estado, work-items activos, sincroniza con `dev` |
| Planificar | [`/plan`](templates/skills/plan.md) | Crea work-item (feature / refactor / fix / chore) + tasks |
| Implementar | [`/apply`](templates/skills/apply.md) | Trabaja la task activa, corre tests |
| Guardar | [`/build`](templates/skills/build.md) | Commit + push + abre PR cuando todas las tasks cierran |
| Revisar | [`/review`](templates/skills/review.md) | Code review del PR antes de mergear |
| Pre-deploy | [`/secure`](templates/skills/secure.md) | Checklist bloqueante; crea work-item con tasks si hay bloqueantes |
| Deploy | [`/deploy`](templates/skills/deploy.md) | Diagnóstico + setup; crea work-item con tasks por componente |

**Comandos de soporte:** [`/branches`](templates/skills/branches.md), [`/sync`](templates/skills/sync.md), [`/cross`](templates/skills/cross.md), [`/audit`](templates/skills/audit.md), [`/pentest`](templates/skills/pentest.md), [`/triage`](templates/skills/triage.md), [`/design`](templates/skills/design.md), [`/setup`](templates/skills/setup.md), [`/debug`](templates/skills/debug.md), [`/rollback`](templates/skills/rollback.md), [`/test`](templates/skills/test.md), [`/tools`](templates/skills/tools.md).

Diagrama del flujo completo, modelo de trabajo y reglas detalladas → [docs/flujo-arquitectura.md](docs/flujo-arquitectura.md).

## Single-repo vs Multi-repo

- **Single-repo**: un solo repositorio. Tres caminos: ya en GitHub, carpeta local, desde cero (clona template del stack).
- **Multi-repo**: varios repos en una carpeta workspace. Pegas todas las URLs / rutas de una vez. Cada repo es autosuficiente con su propio `CLAUDE.md`.

## Actualizar un workspace existente

```bash
npx workspace-template update
```

Compara hash por hash skills, rules y scripts contra el paquete actual. Marca cada cambio:

| Símbolo | Significa |
|---|---|
| `+` | Nuevo en el template, no estaba en tu workspace |
| `~` | Actualizado upstream, sin cambios locales tuyos |
| `!` | Actualizado upstream **pero tienes cambios locales** (default unchecked) |
| `-` | Obsoleto, ya no existe en el template (default checked = se elimina) |
| `×` | Lo borraste localmente — **no se reinstala** salvo que lo marques explícitamente |

Eliges qué aplicar. **Tus cambios locales se respetan por defecto:**

- Si modificaste un skill localmente, el update no lo sobrescribe a menos que lo elijas.
- Si borraste un archivo del template a propósito (porque no lo usabas), el update **no lo trae de vuelta**. Aparece marcado con `×` para que lo recuperes solo si lo decides.
- Si añadiste skills/rules tuyos que no son del template, el updater no los toca ni los lista.

## Stacks soportados

Next.js / React, Vue / Nuxt, Django, FastAPI, React Native, Flutter, Go, o cualquier otro como texto libre. Si el repo tiene manifest detectable (`package.json`, `pyproject.toml`, `go.mod`, etc.), el CLI lo detecta automáticamente. Si no, no te pregunta por stack — sirve igual para repos de configuración o agentes.

## Integraciones MCP

Notion, Linear, Slack, Sentry, Postgres, Context7, n8n. La config queda en `.claude/settings.json`.

## Requisitos

- Node.js 18+ (recomendado: 22 LTS)
- `git` y `gh` (GitHub CLI)

El CLI detecta lo que falta y muestra el comando de instalación según tu OS.

## Más

- [docs/flujo-arquitectura.md](docs/flujo-arquitectura.md) — diagrama completo, modelo work-item + tasks, reglas del flujo
- [docs/flujo-autenticacion.md](docs/flujo-autenticacion.md) — cómo el CLI resuelve credenciales
- [CHANGELOG.md](CHANGELOG.md) — todas las versiones y cambios

## Licencia

MIT
