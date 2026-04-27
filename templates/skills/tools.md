---
name: tools
description: Instala herramientas recomendadas para potenciar Claude Code en este proyecto (Context7, UI UX Pro Max). Úsalo si no las instalaste durante el setup o si quieres verificar que estén al día.
---

# /tools

Verifica e instala las herramientas complementarias recomendadas para este workspace.

## Herramientas disponibles

| Herramienta | Para qué sirve |
|---|---|
| **Context7** | Inyecta docs actualizadas de cualquier librería directamente en tu prompt — elimina respuestas desactualizadas |
| **UI UX Pro Max** | Inteligencia de diseño: estilos, paletas, tipografía, componentes y accesibilidad |

## Pasos

### 1. Verificar estado actual

```bash
# Context7
npx ctx7 --version 2>/dev/null && echo "✓ Context7 instalado" || echo "✗ Context7 no encontrado"

# UI UX Pro Max
uipro --version 2>/dev/null && echo "✓ UI UX Pro Max instalado" || echo "✗ UI UX Pro Max no encontrado"
```

### 2. Instalar las que falten

**Context7:**
```bash
npx ctx7 setup --claude
```

**UI UX Pro Max:**
```bash
npm install -g uipro-cli
uipro init --ai claude
```

### 3. Verificar instalación

Después de instalar, confirma que Claude Code reconoce las herramientas:
- Context7: escribe `use context7` al final de cualquier prompt
- UI UX Pro Max: invoca `/design` en este workspace

## Siguiente paso

Con las herramientas instaladas, retoma el flujo normal:
- `/init` — revisar estado del repo e issues activos
- `/design` — ahora con UI UX Pro Max disponible
