---
name: init
description: Inicia sesión: lee estado del repo, issues activos y rama actual. Usar al arrancar.
---

# /init

Inicia una sesión de desarrollo. Orienta a Claude sobre el estado actual del proyecto.

## Cuándo invocar

Al inicio de cada sesión de trabajo, antes de empezar cualquier tarea.

## Pasos

### 1. Verificar estado del repo / workspace

```bash
# Estado git
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

## Notas

- Si no hay issues asignados, sugerir revisar el backlog del GitHub Project.
- Nunca asumir contexto de sesiones anteriores — siempre leer desde GitHub.
