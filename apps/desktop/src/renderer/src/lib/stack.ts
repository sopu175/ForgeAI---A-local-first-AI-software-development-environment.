import type { ProjectStack } from '@forgeai/shared';

export interface SuggestedCommand {
  label: string;
  command: string;
  kind: 'install' | 'test' | 'build' | 'run' | 'other';
}

export function packageManager(stack: ProjectStack): 'yarn' | 'pnpm' | 'bun' | 'npm' {
  if (stack.packageManagers.includes('yarn')) return 'yarn';
  if (stack.packageManagers.includes('pnpm')) return 'pnpm';
  if (stack.packageManagers.includes('bun')) return 'bun';
  return 'npm';
}

export function suggestedCommands(stack: ProjectStack): SuggestedCommand[] {
  const commands: SuggestedCommand[] = [];
  const pm = packageManager(stack);
  const hasNode = stack.languages.includes('typescript') || stack.languages.includes('javascript');
  if (hasNode) {
    const prefix = pm === 'npm' ? 'npm run ' : `${pm} `;
    commands.push({ label: 'Install', command: `${pm} install`, kind: 'install' });
    commands.push({ label: 'Dev server', command: pm === 'npm' ? 'npm run dev' : `${pm} dev`, kind: 'run' });
    commands.push({ label: 'Test', command: pm === 'npm' ? 'npm test' : `${pm} test`, kind: 'test' });
    commands.push({ label: 'Build', command: `${prefix}build`, kind: 'build' });
    commands.push({ label: 'Typecheck', command: `${prefix}typecheck`, kind: 'test' });
    commands.push({ label: 'Lint', command: `${prefix}lint`, kind: 'test' });
  }
  if (stack.frameworks.includes('Laravel')) {
    commands.push(
      { label: 'Serve', command: 'php artisan serve', kind: 'run' },
      { label: 'Test', command: 'php artisan test', kind: 'test' },
      { label: 'Migrations', command: 'php artisan migrate', kind: 'other' },
    );
  }
  if (stack.frameworks.includes('WordPress')) {
    commands.push({ label: 'PHP server', command: 'php -S 127.0.0.1:8080', kind: 'run' });
  }
  if (stack.frameworks.includes('Django')) {
    commands.push(
      { label: 'Run server', command: 'python manage.py runserver', kind: 'run' },
      { label: 'Migrations', command: 'python manage.py migrate', kind: 'other' },
      { label: 'Test', command: 'pytest -q', kind: 'test' },
    );
  } else if (stack.languages.includes('python')) {
    commands.push({ label: 'Test', command: 'pytest -q', kind: 'test' });
  }
  if (stack.languages.includes('php') && !stack.frameworks.includes('Laravel')) {
    commands.push({ label: 'PHP server', command: 'php -S 127.0.0.1:8000', kind: 'run' });
  }
  if (stack.languages.includes('go')) {
    commands.push(
      { label: 'Run', command: 'go run .', kind: 'run' },
      { label: 'Test', command: 'go test ./...', kind: 'test' },
      { label: 'Build', command: 'go build ./...', kind: 'build' },
    );
  }
  if (stack.languages.includes('rust')) {
    commands.push(
      { label: 'Run', command: 'cargo run', kind: 'run' },
      { label: 'Test', command: 'cargo test', kind: 'test' },
      { label: 'Build', command: 'cargo build', kind: 'build' },
    );
  }
  return commands;
}

export function primaryRunCommand(stack: ProjectStack): string | null {
  const commands = suggestedCommands(stack);
  return commands.find((entry) => entry.kind === 'run')?.command ?? null;
}

export function testCommand(stack: ProjectStack): string | null {
  const commands = suggestedCommands(stack);
  return commands.find((entry) => entry.kind === 'test' && entry.label.toLowerCase().includes('test'))?.command ?? null;
}
