# Testing Rules

## Nombres descriptivos

- `def test_rejects_request_when_email_missing()` > `def test_1()`
- Agrupar con `class TestX` (pytest) o `describe` (jest/vitest).
- Docstrings en español, nombres de funciones en inglés.

## Independencia

- Cada test debe ser independiente — sin estado mutable compartido entre tests.
- Fixtures se re-crean por test.
- En JS, evitar mocks globales que persistan entre tests.

## Real > mock

- Preferir implementaciones reales sobre mocks.
- Mock solo servicios externos (APIs de terceros, pasarelas de pago, servicios de email).
- En backend: usar DB real (test container), NO sqlite para proyectos con PostgreSQL.
- En frontend: usar MSW (mock service worker) para mockear fetch/axios.

## Qué testear

Cada feature debe tener al menos:
- **Happy path**: el caso principal funciona.
- **Validation errors**: inputs inválidos devuelven errores claros.
- **Auth errors**: usuario sin permiso → 401/403.
- **Edge cases**: bordes del dominio.

## Obligatorios para mutaciones

Cualquier endpoint/hook que cambia estado requiere:
- Test que el estado cambia correctamente.
- Test que re-ejecutar es idempotente (si aplica) o conflict (409).
- Test que el usuario sin permiso recibe 403.

## Prohibidos

- NO escribir tests vacíos sin asserts.
- NO escribir tests que siempre pasen (`assert True`).
- Al escribir un test nuevo, correrlo con el código roto para confirmar que **falla**, luego arreglar y confirmar que **pasa**.

## Cleanup

- Tests dejan la DB limpia.
- No hacer `Model.objects.all().delete()` en tests — usar fixtures scoped.

## Gate de tests por stack (lo que `/apply` ejecuta)

`/apply` corre el gate apropiado según el stack del repo, en modo one-shot, sin watchers, sin browsers headed, sin prompts. La detección y los comandos están en [lib/stack-detect.js](../../lib/stack-detect.js) → `detectTestCapabilities()`.

| Stack | Comando del gate |
|---|---|
| Django (con pytest) | `uv run pytest -x -q --tb=short` |
| Django (sin pytest) | `python manage.py test --keepdb -v 1` |
| FastAPI | `uv run pytest -x -q --tb=short` |
| Go | `go test -short -count=1 ./...` |
| Flutter | `flutter test --reporter compact` |
| React Native (jest) | `<pkg-mgr> test -- --ci --reporters=default` |
| Frontend web (con Playwright) | `<pkg-mgr> run test:e2e` |

**Package manager** se detecta por lockfile: `pnpm-lock.yaml` → `pnpm`, `yarn.lock` → `yarn`, `bun.lockb`/`bun.lock` → `bun`, fallback `npm`.

## Frontend web — Playwright como gate único

Decisión del workspace: en frontend web (Next.js, React, Vue, Nuxt) **el gate es Playwright**. No se usan Vitest/Jest unitarios como gate — el dev puede correrlos a mano si quiere, pero `/apply` no los invoca. Razón: Playwright cubre el flujo real del usuario en navegador, lo que importa para apps. Los unitarios siguen siendo útiles pero no bloquean el commit.

### Convenciones obligatorias

- **Script en `package.json`:** debe llamarse `test:e2e` (no `dev`, no `start` — esos chocan con comandos clásicos).
  ```json
  {
    "scripts": {
      "test:e2e": "playwright test --reporter=line"
    }
  }
  ```
- **Puerto del webServer: `39847`** (rango efímero alto, fuera de los típicos 3000/5173/8080/4200/8000). Configurable con `PLAYWRIGHT_E2E_PORT`.
- **`webServer` en `playwright.config.ts`** — el runner levanta y baja el server local; `/apply` nunca arranca `npm run dev` aparte:
  ```ts
  import { defineConfig } from '@playwright/test';
  const PORT = Number(process.env.PLAYWRIGHT_E2E_PORT ?? 39847);

  export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 30_000,
    reporter: 'line',
    use: { baseURL: `http://localhost:${PORT}`, headless: true },
    webServer: {
      command: `<pkg-mgr> run dev -- --port ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  });
  ```
- **Carpeta `tests/e2e/`** al nivel del repo (no dentro de `app/` ni `src/`). El bundler de producción no la incluye. Está bajo Git pero no bajo el build.
- **Headless siempre.** Nunca `--headed` en el gate. El dev puede usar `--ui` o `--headed` a mano para debug.
- **Mocks > datos reales.** Si la UI llama a la API y se puede mockear con MSW, hacerlo. No pedir credenciales reales al dev.

### Spec mínimo para tasks de UI

Cuando una task implementa un componente o flujo nuevo, el commit incluye también su spec en `tests/e2e/`:

```ts
// tests/e2e/<componente>.spec.ts
import { test, expect } from '@playwright/test';

test('<Componente> renderiza y responde a la interacción primaria', async ({ page }) => {
  await page.goto('/ruta-del-componente');
  await expect(page.getByRole('heading', { name: /título esperado/i })).toBeVisible();
  await page.getByRole('button', { name: /acción primaria/i }).click();
  await expect(page.getByText(/feedback esperado/i)).toBeVisible();
});

test('<Componente> muestra error en input inválido', async ({ page }) => {
  await page.goto('/ruta-del-componente');
  await page.getByLabel(/email/i).fill('no-es-email');
  await page.getByRole('button', { name: /enviar/i }).click();
  await expect(page.getByText(/email inválido/i)).toBeVisible();
});
```

Patrón: **happy path + un caso de error/validación.** Mismo criterio que en backend.

### Frontend sin Playwright

Si el repo es frontend web pero no tiene `@playwright/test` instalado, `/apply` no bloquea — sugiere abrir un work-item `chore` para integrarlo:
- Instalar `@playwright/test` y correr `playwright install --with-deps`.
- Crear `playwright.config.ts` con la convención de arriba.
- Agregar script `"test:e2e"` en `package.json`.
- Crear carpeta `tests/e2e/` con `.gitkeep`.
- Agregar `playwright-report/`, `test-results/` y `.playwright-cache/` al `.gitignore`.

## Mobile — comando nativo del stack

- **Flutter:** `flutter test --reporter compact`. Tests viven en `test/` (convención del stack). Widget tests + integration tests si aplica.
- **React Native:** `<pkg-mgr> test -- --ci --reporters=default` (jest del propio RN). Tests en `__tests__/` o `*.test.tsx` co-localizados.

Detox y Maestro son opciones para E2E móvil, pero **no son gate por defecto** — si el equipo los adopta, el work-item de integración los incluye y `/apply` los suma como gate adicional.

## Backend — comando nativo del stack

Cada backend tiene su forma estándar; el gate respeta la del stack:

- **Django/FastAPI:** pytest si está disponible (mejor reporting); fallback a `manage.py test` para Django sin pytest.
- **Go:** `go test -short -count=1 ./...`. El `-short` permite a los tests largos saltarse vía `if testing.Short() { t.Skip() }` cuando hace sentido.
- **Otros backends futuros (Rust, Java, etc.):** se agregan al detector siguiendo el mismo patrón — un comando nativo, one-shot, no-interactivo.
