---
name: design
description: UI/UX: estilos, componentes, paletas, accesibilidad y layout.
---

# /design

UI/UX design intelligence for web interfaces. Includes style recommendations, color palettes, accessibility checks, component design, and responsive layout guidance.

## Verificación previa — UI UX Pro Max

Antes de continuar, verifica si UI UX Pro Max está instalado:

```bash
uipro --version 2>/dev/null && echo "✓ disponible" || echo "✗ no instalado"
```

Si no está instalado, avisa al usuario y ofrece instalarlo:

```bash
npm install -g uipro-cli && uipro init --ai claude
```

Si no puede instalarse ahora, continúa con las capacidades base de este skill. Para instalarlo después: `/tools`.

---

## When to invoke

- Designing a new page, screen, or component from scratch.
- Reviewing existing UI for accessibility, usability, or visual consistency.
- Choosing a color palette, typography, or spacing system.
- Improving a form, table, or data-heavy interface.

## Design process

1. **Understand context.** What is the user's goal on this screen? What is the business context?
2. **Define constraints.** Stack (React/Next.js/Vue/etc.), existing design tokens, breakpoints.
3. **Propose structure.** Sketch the layout in text (wireframe description) before writing code.
4. **Choose visual style.** Select or suggest a style: minimalism, glassmorphism, bento grid, dark mode, etc.
5. **Implement.** Write the component with Tailwind classes (or equivalent), ensuring:
   - Semantic HTML (`<button>`, `<nav>`, `<main>`, ARIA roles where needed).
   - Keyboard navigable (Tab order, focus rings, Enter/Space for buttons).
   - Color contrast ≥ 4.5:1 (WCAG AA).
   - Responsive (mobile-first, at least 2 breakpoints).
6. **Review.** Self-check against the accessibility checklist below.

## Accessibility checklist

- [ ] All images have `alt` text (or `alt=""` if decorative).
- [ ] Form inputs have associated `<label>` elements.
- [ ] Focus states are visible and not removed with `outline: none` without a replacement.
- [ ] Color is not the only means of conveying information.
- [ ] Touch targets are at least 44×44px on mobile.
- [ ] Error messages are associated with the field via `aria-describedby`.
- [ ] Page has a single `<h1>` and heading hierarchy is logical.

## Style quick-reference

| Style | Key characteristics |
|---|---|
| Minimalism | Lots of whitespace, 1-2 colors, clean type |
| Glassmorphism | Frosted glass `backdrop-blur`, semi-transparent panels |
| Bento grid | Card-based asymmetric grid layout |
| Dark mode | `bg-zinc-900`, muted text, accent color |
| Brutalism | Bold borders, high contrast, raw type |
| Neumorphism | Soft shadows on same-color background |

## Output

- Wireframe description (text).
- Component code (clean, accessible, responsive).
- Color and typography recommendations if a new design system is needed.
- Accessibility findings with severity and fix.

## Siguiente paso

- **Diseño aprobado, listo para implementar** → `/apply` (escribir el código)
- **Necesitas validar accesibilidad antes de producción** → `/review` con checklist a11y
- **Cambio impacta UX de varios módulos** → `/plan` para dividir en sub-issues
- **Necesitas docs UI/UX avanzadas** → activar skill `ui-ux-pro-max` de la comunidad
