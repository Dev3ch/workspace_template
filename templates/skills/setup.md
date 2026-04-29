---
name: setup
description: Regenera CLAUDE.md y config de un repo individual.
---

# /setup

Genera o refresca la configuración completa de Claude Code para un repo individual. Útil cuando el repo no tiene `CLAUDE.md` todavía, o cuando la config está desactualizada.

## Cuándo invocar

- El repo no tiene `CLAUDE.md` ni `.claude/`.
- El `CLAUDE.md` está desactualizado y necesita un refresh completo.
- Quieres trabajar en un solo repo en aislamiento, sin el workspace raíz.
- Se incorporó un repo nuevo al equipo y hay que dejarlo listo.

## Pasos

### 1. Leer el repo

```bash
# Estructura general
find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' \
  -not -path '*/__pycache__/*' | sort

# Stack
cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || \
  cat go.mod 2>/dev/null || cat pubspec.yaml 2>/dev/null

# CLAUDE.md existente (si hay)
cat CLAUDE.md 2>/dev/null

# Remote de GitHub
git remote get-url origin 2>/dev/null
```

### 2. Identificar el stack exacto

Detectar:
- **Lenguaje y versión** (Node 22, Python 3.12, Go 1.22, Dart 3.x)
- **Framework** (Next.js, Django, FastAPI, Gin, Flutter)
- **Test runner** (Jest, pytest, go test, flutter test)
- **Linter** (ESLint, Ruff, golangci-lint)
- **Base de datos** (Postgres, SQLite, Firestore)
- **Servicios externos** (Stripe, Auth0, S3, etc.)
- **Puerto local** (si aplica)

### 3. Generar `CLAUDE.md`

El archivo debe permitir que Claude empiece a trabajar sin hacer ninguna pregunta. Incluir:

```markdown
# CLAUDE.md

## Qué es este repo
<1 párrafo: qué hace, para quién, cuál es su rol en el sistema>

## Stack
- Lenguaje: <versión exacta>
- Framework: <nombre y versión>
- DB: <motor>
- Tests: <runner>
- Linter: <herramienta>

## Levantar localmente
\`\`\`bash
<comandos exactos para instalar deps y correr el servidor>
\`\`\`

## Correr tests
\`\`\`bash
<comando exacto>
\`\`\`

## Estructura clave
<árbol de los directorios más importantes con una línea de descripción cada uno>

## Decisiones arquitectónicas importantes
<patrones que se siguen, anti-patrones que se evitan, gotchas>

## Comunicación con otros servicios
<qué endpoints consume, qué headers propaga, qué eventos emite>

## Convenciones
<naming, estructura de archivos, estilo de imports>
```

### 4. Generar `.claude/rules/`

Copiar las rules correspondientes al stack detectado:

| Stack | Rules a incluir |
|---|---|
| Next.js / React | `commits.md`, `branching.md`, `tests.md`, `typescript.md` |
| Django | `commits.md`, `branching.md`, `tests.md`, `python-django.md` |
| FastAPI | `commits.md`, `branching.md`, `tests.md`, `python-fastapi.md` |
| Go | `commits.md`, `branching.md`, `tests.md`, `go.md` |
| Flutter | `commits.md`, `branching.md`, `tests.md`, `flutter.md` |

### 5. Generar `.claude/skills/`

Incluir el flujo estándar completo:

```
.claude/skills/
├── init.md
├── plan.md
├── apply.md
├── test.md
├── build.md
├── review.md
├── secure.md
└── deploy.md
```

### 6. Generar `.github/` si no existe

```
.github/
├── ISSUE_TEMPLATE/
│   ├── feature.md
│   ├── refactor.md
│   ├── bug.md
│   ├── chore.md
│   └── task.md
└── pull_request_template.md
```

### 7. Commitear todo

```bash
git add CLAUDE.md .claude/ .github/
git commit -m "chore(setup): add Claude Code autonomous config"
git push
```

### 8. Verificar calidad del CLAUDE.md

El archivo está completo si Claude puede responder estas preguntas sin leer más código:

- [ ] ¿Qué hace este repo?
- [ ] ¿Cómo lo levanto localmente?
- [ ] ¿Cómo corro los tests?
- [ ] ¿Qué patrones sigue el equipo?
- [ ] ¿Con qué otros servicios se comunica?

Si alguna respuesta es "no sé" → completar el `CLAUDE.md` antes de continuar.

## Output esperado

```
=== /setup completado ===
Repo: mi-org/mi-repo
Stack detectado: Django 5.0 + Python 3.12 + pytest

Archivos generados:
  ✓ CLAUDE.md
  ✓ .claude/rules/commits.md
  ✓ .claude/rules/branching.md
  ✓ .claude/rules/tests.md
  ✓ .claude/rules/python-django.md
  ✓ .claude/skills/init.md ... deploy.md (8 skills)
  ✓ .github/ISSUE_TEMPLATE/ (3 templates)
  ✓ .github/pull_request_template.md

Commit: chore(setup): add Claude Code autonomous config ✓

Listo para: /init
```

## Siguiente paso

- **Config generada, repo listo** → `/init` para empezar a trabajar
- **CLAUDE.md incompleto (faltan respuestas del checklist)** → completar manualmente antes de continuar
- **Primer deploy nunca hecho** → `/secure` + `/deploy` para cerrar el ciclo completo
- **Stack no estándar** → crear rule personalizada en `.claude/rules/` antes de continuar

## Notas

- Si el repo ya tiene `CLAUDE.md`, leerlo primero y preservar las secciones que siguen siendo válidas — no sobreescribir sin comparar.
- No modificar código de la aplicación — solo archivos de configuración de Claude Code y GitHub.
- Si el repo es parte de un multi-repo, verificar que el `CLAUDE.md` generado sea consistente con el del workspace raíz.
