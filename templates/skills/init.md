---
name: init
description: Inicia sesión: lee estado del repo, issues activos y rama actual. Usar al arrancar.
---

# /init

Inicia una sesión de desarrollo. Orienta a Claude sobre el estado actual del proyecto.

## Cuándo invocar

Al inicio de cada sesión de trabajo, antes de empezar cualquier tarea.

## Pasos

### 0. Resolver credenciales de GitHub

```bash
source .claude/scripts/resolve-gh-creds.sh || exit 1
```

El script detecta automáticamente la cuenta con acceso al repo (revisa remote
con creds embebidas, .claude-credentials, keychain del SO, y sesión de `gh`).
Valida el token contra el repo antes de cachear. Si nada funciona, muestra
instrucciones claras.

### 0.5 Posicionarse en `dev` (obligatorio por sesión)

**Regla del workspace:** cada sesión nueva arranca en `dev`. Esto no es una sugerencia
— es la base de trabajo compartida entre features, y las skills siguientes (`/plan`,
`/apply`, `/build`) asumen que estás ahí.

Single-repo:
```bash
git fetch origin --prune

if git ls-remote --heads origin dev | grep -q dev; then
  git checkout dev 2>/dev/null || git checkout -b dev origin/dev
  git pull --ff-only origin dev
else
  echo "⚠  No existe rama dev en remote."
  echo "   Correr /branches para crearla antes de continuar."
  exit 1
fi
```

Multi-repo: aplicar el mismo checkout a **cada repo** listado en el `CLAUDE.md` del
workspace. No dejar ningún repo en `main` o `master` al iniciar la sesión.

```bash
# Ejemplo (iterar sobre los repos del workspace):
for repo in repos/*/; do
  (cd "$repo" && git fetch origin --prune && \
   git checkout dev 2>/dev/null || git checkout -b dev origin/dev && \
   git pull --ff-only origin dev)
done
```

**Excepción mid-chat:** si el dev pide explícitamente trabajar en `main` (ej. hotfix,
pentest, revisión de prod), confirmar una sola vez:

> "`main` es producción — solo hotfixes y auditorías van directo ahí. ¿Continuar?"

Esa decisión **solo dura la sesión actual**. El próximo `/init` volverá a `dev`.

Si `dev` no existe en el remote → invocar `/branches` para crearla y reiniciar `/init`.

### 1. Verificar estado del repo / workspace

```bash
# Estado git (ya en dev)
git status
git log --oneline -10

# Si es multi-repo: verificar cada repo relevante
# git -C <repo-path> status
```

### 2. Revisar issues activos en GitHub

```bash
# Issues asignados al usuario
gh issue list --assignee @me --state open --json number,title,labels,url

# Issues en progreso (label o estado en project board)
gh issue list --label "in-progress" --state open --json number,title,url
```

### 3. Revisar PRs abiertos

```bash
gh pr list --author @me --state open --json number,title,url,isDraft
```

### 4. Si se pasa un número de issue

```bash
gh issue view <N> --json title,body,comments,assignees,labels,url
```

### 5. Identificar la tarea

Basándose en la información recabada:
- Si hay una tarea en progreso (label/board): continuar esa.
- Si no hay nada asignado: mostrar el backlog y preguntar al dev qué tomar.
- Si se pasó un issue específico: mostrar su detalle y plan de acción.

### 6. Orientación

Mostrar al dev:
- **Rama actual** y si está al día con `dev`.
- **Próximo paso concreto** (qué archivo tocar, qué función escribir).
- **Contexto del issue** si hay uno activo.

## Output esperado

```
=== Sesión iniciada ===
Rama: feat/issue-42-payment-flow (2 commits adelante de dev)

Issue activo: #42 — Agregar flujo de pago con Stripe
Estado: In Progress
Último progreso: [último comment del issue]

Próximo paso: Implementar webhook handler en apps/payments/views.py
```

## Siguiente paso

Según el estado detectado:

- **Hay issue en progreso con rama creada** → `/apply` (continuar implementación)
- **Hay issue asignado pero sin rama** → `/plan` (detallar tareas) o `/apply` (empezar directo)
- **Backlog vacío o necesitas decidir qué hacer** → `/plan` (crear nuevo issue)
- **Otros devs hicieron cambios recientes** → `/sync` primero, luego `/plan` o `/apply`
- **Hay un PR abierto esperando review** → `/review`
- **No existe rama `dev` en el repo** → `/branches` para normalizar antes de continuar

## Notas

- Si no hay issues asignados, sugerir revisar el backlog del GitHub Project.
- Nunca asumir contexto de sesiones anteriores — siempre leer desde GitHub.
- **Base por defecto: `dev`.** Cualquier trabajo en `main` requiere confirmación explícita del dev y no persiste al reiniciar la sesión.
