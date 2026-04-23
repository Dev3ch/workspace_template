# /build

Guarda el progreso de la sesión en GitHub y hace push del trabajo.

## Cuándo invocar

Al final de cada sesión de trabajo, o cuando el dev pide guardar progreso.

## Pasos

### 1. Revisar cambios actuales

```bash
git status
git diff --stat
```

### 2. Hacer commit de los cambios pendientes

Si hay cambios sin commitear, hacer commit con mensaje descriptivo:

```bash
git add <archivos-relevantes>
git commit -m "wip(scope): descripción del progreso #N"
```

### 3. Push

```bash
git push origin <branch-actual>
```

Si el branch no tiene upstream:
```bash
git push -u origin <branch-actual>
```

### 4. Actualizar el issue con el progreso

Crear un comment en el issue activo con:
- Qué se hizo en esta sesión
- Estado actual (qué falta)
- Próximo paso para la siguiente sesión
- Links a commits o archivos modificados relevantes

```bash
gh issue comment <N> --body "$(cat <<'EOF'
## Progreso sesión $(date +%Y-%m-%d)

**Hecho:**
- [descripción de lo implementado]

**Estado:** [En progreso / Listo para review / Bloqueado por X]

**Próximo paso:**
- [qué hacer en la siguiente sesión]

**Archivos modificados:**
- [lista de archivos clave]
EOF
)"
```

### 5. Actualizar board (si aplica)

Si el issue está listo para review:
```bash
# Mover issue a "In Review" en el project board
gh issue edit <N> --add-label "review"
```

## Siguiente paso

- **Feature completa, PR listo para revisar** → `/review`
- **Feature completa y va a main/staging** → `/secure` (pre-deploy) → `/deploy`
- **Trabajo en progreso, continuar mañana** → `/init` en la próxima sesión
- **Trabajo afecta otros repos del workspace** → `/cross` para coordinar

## Notas

- Nunca guardar progreso en archivos locales fuera del repo.
- Si el trabajo está en varios repos, hacer push en todos.
- Un comment por sesión, no spam de comments — editar el último si la sesión sigue.
