import fs from 'fs';
import path from 'path';

/**
 * Detecta los stacks presentes en un repo leyendo archivos manifest.
 * Devuelve los valores internos compatibles con STACK_LABELS del CLI:
 * nextjs, react, vue, nuxt, react-native, django, fastapi, go, flutter.
 *
 * @param {string} repoPath
 * @returns {{ stacks: string[], evidence: Record<string, string[]> }}
 *   stacks: lista deduplicada de stacks detectados
 *   evidence: por cada stack, los archivos/razones que lo identificaron
 */
export function detectStacks(repoPath) {
  const stacks = new Set();
  const evidence = {};
  const add = (stack, reason) => {
    stacks.add(stack);
    (evidence[stack] ??= []).push(reason);
  };

  const exists = (rel) => fs.existsSync(path.join(repoPath, rel));
  const readJson = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(repoPath, rel), 'utf8'));
    } catch {
      return null;
    }
  };
  const readText = (rel) => {
    try {
      return fs.readFileSync(path.join(repoPath, rel), 'utf8');
    } catch {
      return '';
    }
  };

  // ── Node / JS ecosystem ──
  if (exists('package.json')) {
    const pkg = readJson('package.json') ?? {};
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

    if (deps['next']) add('nextjs', 'package.json → next');
    if (deps['nuxt'] || deps['nuxt3']) add('nuxt', 'package.json → nuxt');
    if (deps['react-native'] || exists('app.json') && readText('app.json').includes('expo')) {
      add('react-native', 'package.json → react-native');
    }
    if (deps['vue'] && !deps['nuxt']) add('vue', 'package.json → vue');
    if (deps['react'] && !deps['next'] && !deps['react-native']) add('react', 'package.json → react');
  }

  // ── Python ──
  if (exists('pyproject.toml') || exists('requirements.txt') || exists('Pipfile') || exists('setup.py')) {
    const pyproject = readText('pyproject.toml');
    const requirements = readText('requirements.txt');
    const pipfile = readText('Pipfile');
    const manifests = pyproject + '\n' + requirements + '\n' + pipfile;

    if (exists('manage.py') || /\bdjango\b/i.test(manifests)) {
      add('django', exists('manage.py') ? 'manage.py detectado' : 'django en manifest');
    }
    if (/\bfastapi\b/i.test(manifests)) {
      add('fastapi', 'fastapi en manifest');
    }
  }

  // ── Go ──
  if (exists('go.mod')) add('go', 'go.mod');

  // ── Flutter / Dart ──
  if (exists('pubspec.yaml')) {
    const pubspec = readText('pubspec.yaml');
    if (/flutter:/.test(pubspec)) add('flutter', 'pubspec.yaml con flutter:');
  }

  return { stacks: [...stacks], evidence };
}

/**
 * Detecta el puerto local probable del proyecto leyendo docker-compose,
 * .env.example, manage.py, next config, etc. Devuelve string o null.
 *
 * @param {string} repoPath
 * @returns {string|null}
 */
export function detectPort(repoPath) {
  const tryRead = (rel) => {
    try {
      return fs.readFileSync(path.join(repoPath, rel), 'utf8');
    } catch {
      return '';
    }
  };

  // docker-compose.*.yml
  for (const f of ['docker-compose.yml', 'docker-compose.local.yml', 'docker-compose.dev.yml']) {
    const content = tryRead(f);
    const match = content.match(/ports:\s*\n\s*-\s*["']?(\d{2,5}):\d{2,5}/);
    if (match) return match[1];
  }

  // .env.example / .env.local
  for (const f of ['.env.example', '.env.local', '.env']) {
    const content = tryRead(f);
    const match = content.match(/^PORT=(\d+)/m);
    if (match) return match[1];
  }

  return null;
}

/**
 * Detecta el package manager del repo JS/TS según el lockfile presente.
 * Orden de prioridad: pnpm > yarn > bun > npm.
 *
 * @param {string} repoPath
 * @returns {'pnpm'|'yarn'|'bun'|'npm'|null}
 *   null si el repo no tiene package.json (no es JS/TS).
 */
export function detectPackageManager(repoPath) {
  const exists = (rel) => fs.existsSync(path.join(repoPath, rel));
  if (!exists('package.json')) return null;
  if (exists('pnpm-lock.yaml')) return 'pnpm';
  if (exists('yarn.lock')) return 'yarn';
  if (exists('bun.lockb') || exists('bun.lock')) return 'bun';
  return 'npm';
}

/**
 * Detecta capacidades de test del repo: qué framework usa, qué comando lo
 * ejecuta en modo gate (one-shot, no-interactivo, CI-friendly), y si hay
 * gaps de cobertura accionables (ej: frontend web sin Playwright).
 *
 * Filosofía:
 * - Backend → comando nativo del stack (pytest, go test, flutter test, etc.).
 * - Frontend web → SOLO Playwright. Si no está, sugerencia (no se instala).
 * - Mobile (RN, Flutter) → comando nativo del stack.
 * - Sin watchers, sin REPLs, sin headed browsers, sin prompts.
 *
 * @param {string} repoPath
 * @returns {{
 *   kind: 'backend'|'frontend'|'mobile'|'unknown',
 *   stacks: string[],
 *   gate: { framework: string, cmd: string, timeoutSec: number } | null,
 *   suggestions: Array<{ id: string, message: string }>
 * }}
 */
export function detectTestCapabilities(repoPath) {
  const exists = (rel) => fs.existsSync(path.join(repoPath, rel));
  const readText = (rel) => {
    try {
      return fs.readFileSync(path.join(repoPath, rel), 'utf8');
    } catch {
      return '';
    }
  };
  const readJson = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(repoPath, rel), 'utf8'));
    } catch {
      return null;
    }
  };

  const { stacks } = detectStacks(repoPath);
  const suggestions = [];

  // ── Mobile (Flutter) ──
  if (stacks.includes('flutter')) {
    return {
      kind: 'mobile',
      stacks,
      gate: { framework: 'flutter-test', cmd: 'flutter test --reporter compact', timeoutSec: 180 },
      suggestions,
    };
  }

  // ── Mobile (React Native) ──
  if (stacks.includes('react-native')) {
    const pm = detectPackageManager(repoPath) ?? 'npm';
    const pkg = readJson('package.json') ?? {};
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (deps['jest']) {
      return {
        kind: 'mobile',
        stacks,
        gate: {
          framework: 'jest-rn',
          cmd: `${pm} test -- --ci --reporters=default`,
          timeoutSec: 120,
        },
        suggestions,
      };
    }
    return { kind: 'mobile', stacks, gate: null, suggestions };
  }

  // ── Frontend web (Next, React, Vue, Nuxt) ──
  // Política: solo Playwright como gate. Vitest/Jest unitarios no entran al gate
  // aunque estén instalados — el dev decide correrlos a mano si quiere.
  const isFrontendWeb =
    stacks.includes('nextjs') ||
    stacks.includes('react') ||
    stacks.includes('vue') ||
    stacks.includes('nuxt');

  if (isFrontendWeb) {
    const pkg = readJson('package.json') ?? {};
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const hasPlaywright = Boolean(deps['@playwright/test']);
    const hasPlaywrightConfig =
      exists('playwright.config.ts') ||
      exists('playwright.config.js') ||
      exists('playwright.config.mjs');
    const pm = detectPackageManager(repoPath) ?? 'npm';

    if (hasPlaywright && hasPlaywrightConfig) {
      // Gate via script test:e2e (no choca con dev clásico). El config define
      // el webServer que levanta y baja el server local en puerto 39847.
      const scripts = pkg.scripts ?? {};
      const hasScript = typeof scripts['test:e2e'] === 'string';
      const cmd = hasScript
        ? `${pm} run test:e2e`
        : `${pm} exec playwright test --reporter=line`;
      return {
        kind: 'frontend',
        stacks,
        gate: { framework: 'playwright', cmd, timeoutSec: 240 },
        suggestions,
      };
    }

    suggestions.push({
      id: 'add-playwright',
      message:
        'Frontend web detectado sin Playwright configurado. Para tener gate E2E real, ' +
        'sugiero abrir un work-item chore para integrar Playwright (script `test:e2e`, ' +
        'puerto 39847, webServer en config). Por ahora /apply no bloqueará por tests.',
    });
    return { kind: 'frontend', stacks, gate: null, suggestions };
  }

  // ── Backend (Django, FastAPI) ──
  const isPython = stacks.includes('django') || stacks.includes('fastapi');
  if (isPython) {
    const pyproject = readText('pyproject.toml');
    const requirements = readText('requirements.txt');
    const pipfile = readText('Pipfile');
    const manifests = pyproject + '\n' + requirements + '\n' + pipfile;
    const hasUv = exists('uv.lock');
    const hasPytest = /\bpytest\b/i.test(manifests);

    if (hasPytest) {
      const runner = hasUv ? 'uv run pytest' : 'pytest';
      return {
        kind: 'backend',
        stacks,
        gate: { framework: 'pytest', cmd: `${runner} -x -q --tb=short`, timeoutSec: 180 },
        suggestions,
      };
    }
    if (stacks.includes('django')) {
      return {
        kind: 'backend',
        stacks,
        gate: { framework: 'django-test', cmd: 'python manage.py test --keepdb -v 1', timeoutSec: 180 },
        suggestions,
      };
    }
  }

  // ── Backend (Go) ──
  if (stacks.includes('go')) {
    return {
      kind: 'backend',
      stacks,
      gate: { framework: 'go-test', cmd: 'go test -short -count=1 ./...', timeoutSec: 180 },
      suggestions,
    };
  }

  return { kind: 'unknown', stacks, gate: null, suggestions };
}
