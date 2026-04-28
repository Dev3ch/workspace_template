# Branching

## Regla de sesión

**Cada sesión nueva (`/init`) arranca en `dev`.** No es sugerencia — es la base
compartida de trabajo del workspace. En multi-repo, **todos** los repos se
posicionan en `dev` al iniciar.

- Trabajar en `main` requiere confirmación explícita del dev y **no persiste**
  al reiniciar la sesión.
- Si un repo no tiene `dev`, invocar `/branches` antes de cualquier otra skill.

## Normalización inicial

Al incorporar un repo nuevo al workspace:

- Default `master` → ofrecer rename a `main` (no bloquea si el usuario rehúsa).
- `dev` obligatoria: se crea automáticamente desde la branch default si no existe.
- `staging` opcional: se pregunta; default es no crearla.

El setup de `workspace-template` lo hace automáticamente al clonar. Para repos
ya existentes, usar `/branches`.

## Modelo: 3 branches protegidas (GitFlow-light)

| Branch | Rol | Protección |
|---|---|---|
| `main` | **Producción.** Solo recibe merges desde `staging` (y hotfixes). Tags de release. | 1 approval, status checks, no force-push, no deletion |
| `staging` | **Pre-producción / QA.** Recibe merges desde `dev` al cerrar un release. | status checks, no force-push, no deletion |
| `dev` | **Integración.** Default para work-items. | status checks, no force-push, no deletion |
| `feature/*`, `refactor/*`, `fix/*`, `chore/*`, `hotfix/*` | Ramas de trabajo efímeras (una por work-item). | sin protección |

## Flujo estándar (work-item + tasks)

Toda planificación se agrupa bajo un **work-item padre** (issue con label `feature`, `refactor`, `fix` o `chore`). Sus **tasks** son sub-issues vinculados nativamente.

1. Crear el work-item con `/plan`. Ejemplo: `[FEATURE] Sistema de pagos con Stripe (#12)` con tasks `#42`, `#43`, `#44`.
2. Crear branch desde `dev`. **El prefijo refleja el tipo del work-item:**
   ```bash
   git checkout dev && git pull
   git checkout -b feature/12-sistema-pagos-stripe
   # o: refactor/15-migracion-auth, fix/18-race-condition, chore/20-update-deps
   ```
3. Implementar **una task a la vez**. Cada task cerrada genera **un commit** con Conventional Commits referenciando la task y el work-item:
   ```
   feat(payments): webhook handler de Stripe (#42) — feature #12
   refactor(payments): extraer cálculo de impuestos (#43) — feature #12
   ```
4. Continuar implementando hasta cerrar todas las tasks del work-item.
5. Abrir **un solo PR contra `dev`** cuando todas las tasks están cerradas. Body incluye `Closes #12` (work-item) y los `Closes #42, #43, #44` (tasks).
6. Code review.
7. **Squash o merge commit** → `dev`. El work-item se cierra al mergear.
8. Si hubo aprendizaje nuevo, actualizar `CLAUDE.md` en el mismo PR.

**Tasks descubiertas durante el desarrollo:** si encuentras algo que falta para cerrar bien el work-item, crear una nueva task hija del mismo padre. Si es un problema de código ya mergeado en producción, abrir un nuevo work-item de tipo `fix`.

## Promoción (release)

1. **`dev` → `staging`**: cuando `dev` está listo para QA, abrir PR `dev → staging` con **merge commit**.
2. **`staging` → `main`**: cuando `staging` pasa QA, abrir PR `staging → main` con **merge commit**. Tag de release en `main`.
3. Las promociones son **manuales** — PR + approval, no auto-promote.

## Hotfix (producción rota)

1. Branch desde `main`: `hotfix/issue-{N}-descripcion`.
2. Arreglo mínimo + test. Commit: `hotfix(scope): descripción #N`.
3. PR contra `main` → squash merge.
4. Cherry-pick o PR adicional del mismo branch a `staging` y `dev`.

## Reglas de merge

- **Un work-item = un branch = un PR** por repo afectado.
- Las **tasks no tienen su propio PR** — se commitean en la rama del work-item padre.
- **Nunca** push directo a `main`, `staging` o `dev` — solo vía PR.
- **Merge strategy**: `squash` o `merge commit` en work-item→dev (a elección del equipo); `merge commit` en dev→staging y staging→main.
- **No rebasear** branches protegidas.
