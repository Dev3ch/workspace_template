# TypeScript Rules

## Stack

- TypeScript 5 strict mode
- Next.js (App Router) o framework equivalente
- React con hooks
- TanStack Query para data fetching
- Zustand para estado global
- react-hook-form para formularios

## Lenguaje

- **Nunca `any`.** Usar `unknown` y narrowing con type guards.
- `type` para uniones/mapped; `interface` para shapes de objetos que se extienden.
- Export types junto a las funciones que los usan.
- Return types explícitos en funciones exportadas.
- `const` sobre `let`. Nunca `var`.
- Optional chaining `?.` y nullish coalescing `??` sobre checks manuales.

## Imports

- ES modules siempre.
- Destructurar: `import { foo } from 'bar'`, no `import * as x`.
- Orden: externos → internos por alias → relativos.

## Naming

- `camelCase`: variables, funciones, hooks.
- `PascalCase`: componentes React, tipos, clases.
- `kebab-case`: archivos de hooks helper.
- Components en `PascalCase.tsx`.

## Patrón de módulos

```
modules/<domain>/
├── lib/
│   ├── types/<domain>-api.ts
│   ├── services/<domain>.service.ts
│   └── hooks/use<Domain>.ts
└── ui/
    ├── <Domain>Table.tsx
    └── <Domain>DetailModal.tsx
```

## React

- Server components por default; `'use client'` solo cuando hace falta.
- Incluir identificador del tenant/org en query keys para evitar leaks cross-tenant.
- No usar `useEffect` para derivar estado — usar `useMemo`.

## Error handling

- Errores de red se tipan con una interfaz `ApiError` con `.displayMessage`.
- Componentes muestran errores localmente, no toast global en mutations.

## Prohibidos

- NO usar enums de TypeScript — usar `as const` objects o union types.
- NO hacer `as any` para silenciar errores del compilador.
