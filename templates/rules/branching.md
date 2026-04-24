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
| `dev` | **Integración.** Default para features y fixes. | status checks, no force-push, no deletion |
| `feat/*`, `fix/*`, `chore/*`, `hotfix/*` | Ramas de trabajo efímeras. | sin protección |

## Flujo estándar (feature / fix)

1. Asignarte un issue en GitHub Projects.
2. Crear branch desde `dev`:
   ```bash
   git checkout dev && git pull
   git checkout -b feat/issue-{N}-descripcion
   ```
3. Commits conventional referenciando issue: `feat(scope): descripción #N`.
4. Abrir PR **contra `dev`**. Body incluye `Closes #N`.
5. Code review.
6. **Squash merge** → `dev`. Un commit limpio por feature.
7. Si hubo aprendizaje nuevo, actualizar `CLAUDE.md` en el mismo PR.

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

- **Un issue = un branch = un PR** por repo afectado.
- **Nunca** push directo a `main`, `staging` o `dev` — solo vía PR.
- **Merge strategy**: `squash` en feat→dev; `merge commit` en dev→staging y staging→main.
- **No rebasear** branches protegidas.
