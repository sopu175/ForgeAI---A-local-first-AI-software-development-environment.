import type { SpecTask } from '@forgeai/shared';

/**
 * Task format (enforced by the tasks prompt):
 *
 * ### T1 — Implement the settings store
 * - depends-on: none
 * - files: src/stores/settings.ts
 * - acceptance: persists to SQLite; UI reads defaults on boot
 *
 * Longer implementation notes may follow as plain paragraphs.
 */
export function parseTasksMarkdown(markdown: string): SpecTask[] {
  const tasks: SpecTask[] = [];
  const heading = /^###\s+(T\d+)\s*[—–-]\s*(.+?)\s*$/gm;
  const matches = [...markdown.matchAll(heading)];
  if (matches.length === 0) return parseCheckboxFallback(markdown);

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const id = match[1]!;
    const title = match[2]!.trim();
    const bodyStart = match.index! + match[0].length;
    const bodyEnd = index + 1 < matches.length ? matches[index + 1]!.index! : markdown.length;
    const body = markdown.slice(bodyStart, bodyEnd);
    const depends = /^-\s*depends-on:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? '';
    const files = /^-\s*files:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? '';
    const acceptanceRaw = /^-\s*acceptance:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? '';
    const statusRaw = /^-\s*status:\s*(pending|in_progress|done|failed|blocked)\s*$/im.exec(body)?.[1];
    const details = body
      .replace(/^-\s*(depends-on|files|acceptance|status):.*$/gim, '')
      .replace(/^#+\s*/gm, '')
      .trim();
    tasks.push({
      id,
      title,
      details,
      files: splitList(files),
      acceptance: splitList(acceptanceRaw),
      dependsOn: splitList(depends).filter((value) => value.toLowerCase() !== 'none'),
      approved: false,
      status: (statusRaw as SpecTask['status']) ?? 'pending',
      order: tasks.length,
    });
  }
  return tasks;
}

function splitList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((part) =>
      part
        .trim()
        .replace(/^`|`$/g, '')
        .replace(/^\[|\]$/g, ''),
    )
    .filter((part) => part.length > 0 && !/^none$/i.test(part));
}

function parseCheckboxFallback(markdown: string): SpecTask[] {
  const tasks: SpecTask[] = [];
  const checkbox = /^\s*[-*]\s*\[([ xX])\]\s+(.+)$/gm;
  for (const match of markdown.matchAll(checkbox)) {
    const title = match[2]!.trim();
    tasks.push({
      id: `T${tasks.length + 1}`,
      title,
      details: '',
      files: [],
      acceptance: [],
      dependsOn: [],
      approved: false,
      status: match[1] === ' ' ? 'pending' : 'done',
      order: tasks.length,
    });
  }
  return tasks;
}

export function serializeTasksMarkdown(tasks: SpecTask[], intro = ''): string {
  const head =
    intro.trim() ||
    '# Implementation Tasks\n\nApproved tasks are executed by the ForgeAI coding agent. Each task is independently reviewable.';
  const body = tasks
    .map((task) => {
      const lines = [
        `### ${task.id} — ${task.title}`,
        `- depends-on: ${task.dependsOn.length ? task.dependsOn.join(', ') : 'none'}`,
        `- files: ${task.files.length ? task.files.join(', ') : 'none'}`,
        `- acceptance: ${task.acceptance.length ? task.acceptance.join('; ') : 'none'}`,
        `- status: ${task.status}`,
      ];
      if (task.details.trim()) lines.push('', task.details.trim());
      return lines.join('\n');
    })
    .join('\n\n');
  return `${head}\n\n${body}\n`;
}

export function tasksReadyForExecution(tasks: SpecTask[]): SpecTask[] {
  const done = new Set(tasks.filter((task) => task.status === 'done').map((task) => task.id));
  return tasks.filter(
    (task) => task.approved && task.status !== 'done' && task.dependsOn.every((dependency) => done.has(dependency)),
  );
}

export function nextTask(tasks: SpecTask[]): SpecTask | undefined {
  return tasksReadyForExecution(tasks).sort((a, b) => a.order - b.order)[0];
}
