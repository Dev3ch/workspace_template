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
