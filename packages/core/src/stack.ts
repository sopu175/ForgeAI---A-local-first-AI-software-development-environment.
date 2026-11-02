import { promises as fs } from 'node:fs';
import path from 'node:path';
import { languageFromPath } from '@forgeai/shared';
import type { ProjectStack } from '@forgeai/shared';
import type { ScannedFile } from './scanner';

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

const FRAMEWORKS: Record<string, string> = {
  next: 'Next.js',
  nuxt: 'Nuxt',
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  '@angular/core': 'Angular',
  express: 'Express',
  fastify: 'Fastify',
  '@nestjs/core': 'NestJS',
  electron: 'Electron',
  tailwindcss: 'Tailwind CSS',
  vite: 'Vite',
  jest: 'Jest',
  vitest: 'Vitest',
  playwright: 'Playwright',
  cypress: 'Cypress',
  prisma: 'Prisma',
  '@prisma/client': 'Prisma',
  mongoose: 'Mongoose',
  laravel: 'Laravel',
  wordpress: 'WordPress',
  django: 'Django',
  flask: 'Flask',
  fastapi: 'FastAPI',
  gin: 'Gin',
  actix: 'Actix',
};

const LANGUAGES = new Set([
  'typescript',
  'javascript',
  'python',
  'php',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'dart',
  'elixir',
]);

export async function detectStack(root: string, files: ScannedFile[] = []): Promise<ProjectStack> {
  const frameworks = new Set<string>();
  const packageManagers = new Set<string>();
  const testRunners = new Set<string>();
  const entryPoints = new Set<string>();
  const languages = new Set<string>();

  for (const file of files.slice(0, 20_000)) {
    const language = languageFromPath(file.path);
    if (LANGUAGES.has(language)) languages.add(language);
  }

  const pkg = await readJson<{
    name?: string;
    main?: string;
    module?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    packageManager?: string;
  }>(path.join(root, 'package.json'));

  if (pkg) {
    languages.add('typescript');
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const dependency of Object.keys(allDeps)) {
      const framework = FRAMEWORKS[dependency];
      if (framework) frameworks.add(framework);
    }
    if (allDeps.jest || pkg.scripts?.test?.includes('jest')) testRunners.add('Jest');
    if (allDeps.vitest || pkg.scripts?.test?.includes('vitest')) testRunners.add('Vitest');
    if (allDeps.playwright || allDeps['@playwright/test']) testRunners.add('Playwright');
    if (allDeps.cypress) testRunners.add('Cypress');
    if (pkg.scripts?.lint) testRunners.add('lint script');
    if (pkg.scripts?.typecheck || pkg.scripts?.tsc) testRunners.add('typecheck script');
    if (pkg.main) entryPoints.add(pkg.main);
    if (pkg.module) entryPoints.add(pkg.module);
    if (pkg.packageManager) packageManagers.add(pkg.packageManager.split('@')[0] ?? pkg.packageManager);
  }

  const lockfiles: Array<[string, string]> = [
    ['yarn.lock', 'yarn'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
    ['composer.lock', 'composer'],
    ['poetry.lock', 'poetry'],
    ['uv.lock', 'uv'],
    ['go.sum', 'go modules'],
    ['Cargo.lock', 'cargo'],
    ['Gemfile.lock', 'bundler'],
  ];
  await Promise.all(
    lockfiles.map(async ([file, manager]) => {
      if (await exists(path.join(root, file))) packageManagers.add(manager);
    }),
  );

  const composer = await readJson<{ require?: Record<string, string> }>(path.join(root, 'composer.json'));
  if (composer) {
    languages.add('php');
    const requires = Object.keys(composer.require ?? {});
    if (requires.includes('laravel/framework')) frameworks.add('Laravel');
    if (requires.some((key) => key.startsWith('yiisoft/'))) frameworks.add('Yii2');
    if (requires.some((key) => key.startsWith('symfony/'))) frameworks.add('Symfony');
  }

  const checks: Array<[string, () => void]> = [
    [
      'artisan',
      () => {
        frameworks.add('Laravel');
        languages.add('php');
        entryPoints.add('artisan');
        testRunners.add('phpunit');
      },
    ],
    [
      'wp-config.php',
      () => {
        frameworks.add('WordPress');
        languages.add('php');
      },
    ],
    [
      'manage.py',
      () => {
        frameworks.add('Django');
        languages.add('python');
        entryPoints.add('manage.py');
        testRunners.add('pytest');
      },
    ],
    [
      'requirements.txt',
      () => {
        languages.add('python');
      },
    ],
    [
      'pyproject.toml',
      () => {
        languages.add('python');
        testRunners.add('pytest');
      },
    ],
    [
      'go.mod',
      () => {
        languages.add('go');
        entryPoints.add('main.go');
        testRunners.add('go test');
      },
    ],
    [
      'Cargo.toml',
      () => {
        languages.add('rust');
        entryPoints.add('src/main.rs');
        testRunners.add('cargo test');
      },
    ],
    ['src/main.tsx', () => entryPoints.add('src/main.tsx')],
    ['src/index.ts', () => entryPoints.add('src/index.ts')],
    ['index.js', () => entryPoints.add('index.js')],
  ];
  await Promise.all(
    checks.map(async ([file, apply]) => {
      if (await exists(path.join(root, file))) apply();
    }),
  );

  return {
    languages: [...languages],
    frameworks: [...frameworks],
    packageManagers: [...packageManagers],
    testRunners: [...testRunners],
    hasGit: await exists(path.join(root, '.git')),
    entryPoints: [...entryPoints].slice(0, 8),
  };
}

export function suggestedCommands(stack: ProjectStack): Array<{ label: string; command: string }> {
  const commands: Array<{ label: string; command: string }> = [];
  const hasNode = stack.languages.includes('typescript') || stack.languages.includes('javascript');
  if (hasNode) {
    if (stack.packageManagers.includes('yarn')) {
      commands.push(
        { label: 'Install', command: 'yarn install' },
        { label: 'Test', command: 'yarn test' },
        { label: 'Build', command: 'yarn build' },
      );
    } else if (stack.packageManagers.includes('pnpm')) {
      commands.push(
        { label: 'Install', command: 'pnpm install' },
        { label: 'Test', command: 'pnpm test' },
        { label: 'Build', command: 'pnpm build' },
      );
    } else {
      commands.push(
        { label: 'Install', command: 'npm install' },
        { label: 'Test', command: 'npm test' },
        { label: 'Build', command: 'npm run build' },
      );
    }
  }
  if (stack.frameworks.includes('Laravel'))
    commands.push({ label: 'Serve', command: 'php artisan serve' }, { label: 'Test', command: 'php artisan test' });
  if (stack.languages.includes('python')) commands.push({ label: 'Test', command: 'pytest -q' });
  if (stack.languages.includes('go')) commands.push({ label: 'Test', command: 'go test ./...' });
  if (stack.languages.includes('rust')) commands.push({ label: 'Test', command: 'cargo test' });
  return commands;
}
