---
name: apply
description: Ejecuta el issue activo: implementa el código y corre los tests. Usar después de /plan.
---

# /apply

Ejecuta el issue activo: lee el plan, implementa el código, corre los tests y reporta resultado.

## Credenciales de GitHub

```bash
source .claude/scripts/resolve-gh-creds.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## Cuándo invocar

Después de `/plan`, cuando tienes un issue asignado y listo para implementar. Es el comando que convierte el plan en código real.

## Estrategia de contexto mínimo

`/apply` puede consumir muchos tokens si lee archivos innecesarios. Seguir este orden de carga **bajo demanda**:

1. **Primero solo leer:** body del issue + `CLAUDE.md` del repo (~2-5k tokens)
2. **Si el issue menciona archivos específicos:** leer solo esos archivos
3. **Si hace falta más contexto:** usar `grep` para buscar símbolos específicos, NO leer directorios completos
4. **Evitar:** `Read` de archivos sin tocar, `ls -R` de proyectos grandes, leer `node_modules`, `vendor`, `dist`
5. **Si el repo es desconocido:** pedir al dev que señale los archivos clave en lugar de explorar

Regla: **antes de cada Read, preguntarse ¿este archivo es necesario para el cambio específico que voy a hacer?**

## Pasos

### 1. Identificar el issue activo

```bash
# Issue en progreso asignado a mí
gh issue list --assignee @me --state open --json number,title,body,labels,url \
  --jq '.[] | select(.labels[].name == "in-progress") // .'

# Si no hay label in-progress, tomar el más reciente asignado
gh issue list --assignee @me --state open --limit 1 --json number,title,body,url
```

Si se pasa un número: `gh issue view <N> --json number,title,body,comments,url`

### 2. Leer el plan del issue

Extraer del body del issue:
- **Archivos a modificar**
- **Criterios de aceptación**
- **Sub-tareas pendientes** (checkboxes)
- **Dependencias** con otros issues

Si el issue no tiene plan estructurado, pedirlo al dev antes de continuar.

### 3. Verificar rama de trabajo

```bash
git status
git branch --show-current
git log --oneline -5

# Crear rama si no existe
# git checkout -b feat/issue-<N>-<descripcion> dev
```

Si no está en una rama `feat/*` o `fix/*`, crear una desde `dev`:
```bash
git checkout dev && git pull origin dev
git checkout -b feat/issue-<N>-<slug-del-titulo>
```

### 4. Leer SOLO el contexto necesario

Aplicar la regla de contexto mínimo:

**Sí leer:**
- Archivos que el plan menciona explícitamente modificar
- Tests existentes del módulo que vas a tocar (si existen)
- La interfaz/tipo exacto que vas a usar (buscar por nombre, no leer el archivo completo)

**No leer:**
- Directorios completos sin motivo
- Archivos de dependencias (`node_modules/`, `vendor/`, `.venv/`)
- Builds o artefactos (`dist/`, `build/`, `__pycache__/`)
- Archivos de configuración que no vas a modificar

```bash
# Buscar UN símbolo específico (rápido, barato)
grep -rn "<NombreClaseOFuncion>" --include="*.ts" --include="*.py" --include="*.go" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist .

# Leer con offset/limit si el archivo es grande
# Read(file_path="...", offset=100, limit=50)
```

Si después de esto aún no tienes claridad: **pregúntale al dev qué archivo tocar**, no explores más.

### 5. Implementar

Ejecutar las sub-tareas del issue en orden:
- Una sub-tarea a la vez
- Verificar que el código nuevo no rompe importaciones existentes
- Seguir las convenciones del stack (ver `.claude/rules/`)

### 6. Correr tests automáticamente

```bash
# Node / Next.js / React
npm test -- --passWithNoTests

# Python / Django
python manage.py test
# o con pytest:
uv run pytest -x -q

# Go
go test ./... -count=1

# Flutter
flutter test
```

Si los tests fallan:
- Analizar el error
- Corregir el código (no modificar los tests para que pasen)
- Volver a correr
- Si después de 3 intentos sigue fallando → llamar a `/debug`

### 7. Verificar cobertura mínima

El código nuevo debe tener al menos:
- Happy path cubierto
- Un caso de error cubierto
- Sin tests vacíos (sin asserts)

### 8. Marcar sub-tareas completadas en el issue

```bash
# Comentar progreso en el issue
gh issue comment <N> --body "### Progreso /apply

- [x] <subtarea 1>
- [x] <subtarea 2>
- [ ] <subtarea 3> — en curso

**Tests:** ✓ pasando
**Rama:** \`$(git branch --show-current)\`"
```

### 9. Preparar para /build

Verificar que todo está listo para commitear:
```bash
git diff --stat
git status
```

## Output esperado

```
=== /apply completado ===
Issue: #42 — Agregar flujo de pago con Stripe

Implementado:
  ✓ apps/payments/views.py — PaymentWebhookView
  ✓ apps/payments/serializers.py — PaymentIntentSerializer
  ✓ tests/payments/test_webhook.py — 4 tests nuevos

Tests: ✓ 47 passed, 0 failed
Cobertura nueva: 89%

Listo para: /build
```

## Siguiente paso

- **Tests pasan, feature completa** → `/build` (commit + push + comentar en el issue)
- **Tests fallan después de 3 intentos** → `/debug` con el error específico
- **Detectas que otro issue ya resolvió parte** → `/sync` para reconciliar, luego volver aquí
- **Issue resultó más grande de lo planeado** → `/plan` para dividir en sub-issues

## Notas

- No hacer commit dentro de `/apply` — ese es trabajo de `/build`.
- Si el issue es muy grande (más de 3 archivos core), sugerir dividirlo en sub-issues con `/plan`.
- Si se detecta que otro issue ya resolvió parte de la tarea → llamar a `/sync` antes de continuar.
- Nunca modificar tests existentes para que pasen — solo el código de producción.
- **Costo:** este skill puede consumir muchos tokens. Priorizar Edit sobre Write, grep sobre Read de archivos completos, y pedir contexto al dev antes de explorar.
