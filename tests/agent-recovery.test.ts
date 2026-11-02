import { describe, expect, it } from 'vitest';
import { AgentRuntimeService, planToolBatches, reportDeniesWrites } from '../apps/desktop/src/main/agent/runtime';
import type { AgentEvent, ChatMessage, ChatToolCall } from '@forgeai/shared';

function runtimeDouble() {
  return new (AgentRuntimeService as unknown as new (...args: unknown[]) => AgentRuntimeService)(
    {},
  ) as AgentRuntimeService & {
    recoverFinalAnswer(args: {
      provider: { chat: (...args: unknown[]) => AsyncIterable<unknown> };
      binding: { providerId: string; model: string };
      contextLength: number;
      task: string;
      messages: ChatMessage[];
      signal: AbortSignal;
      emit: (event: AgentEvent) => void;
    }): Promise<string>;
    buildFallbackSummary(
      steps: number,
      changedFiles: ReadonlyMap<string, { path: string }>,
      commandsRun: string[],
      messages: ChatMessage[],
    ): string;
    finalAnswerText(text: string): string;
    verifyDomReferences(changedFiles: ReadonlyMap<string, unknown>, files: readonly string[]): Promise<string[]>;
    workspace: { readFile(path: string): Promise<{ content: string }> };
  };
}

const binding = { providerId: 'ollama', model: 'qwen3.5:4b' };
const baseArgs = {
  binding,
  contextLength: 8192,
  task: 'Audit the SEO of this site.',
  messages: [{ role: 'tool', content: 'robots.txt: found at public/robots.txt' }] as ChatMessage[],
  signal: new AbortController().signal,
};

describe('agent empty-response recovery', () => {
  it('asks once without tools and returns the recovered report', async () => {
    const runtime = runtimeDouble();
    const events: AgentEvent[] = [];
    const requests: Array<{ tools?: unknown; messages: ChatMessage[] }> = [];
    const provider = {
      async *chat(request: { tools?: unknown; messages: ChatMessage[] }) {
        requests.push(request);
        yield { type: 'text', text: 'Recovered final report.' };
        yield { type: 'done' };
      },
    };

    const text = await runtime.recoverFinalAnswer({
      ...baseArgs,
      provider,
      emit: (event) => events.push(event),
    });

    expect(text).toBe('Recovered final report.');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.tools).toBeUndefined();
    expect(events).toEqual([{ type: 'assistant', text: 'Recovered final report.' }]);
  });

  it('returns an empty string when the recovery call is also empty', async () => {
    const runtime = runtimeDouble();
    const provider = {
      async *chat() {
        yield { type: 'done' };
      },
    };
    const text = await runtime.recoverFinalAnswer({ ...baseArgs, provider, emit: () => undefined });
    expect(text).toBe('');
  });

  it('unwraps a final envelope from a tool-free answer', () => {
    const runtime = runtimeDouble();
    expect(runtime.finalAnswerText('{"final":"Updated app.js and README.md."}')).toBe('Updated app.js and README.md.');
    expect(runtime.finalAnswerText('```json\n{"final":"Done."}\n```')).toBe('Done.');
    expect(runtime.finalAnswerText('Plain **Markdown** report.')).toBe('Plain **Markdown** report.');
  });

  it('falls back to a deterministic report with changes, commands and evidence', () => {
    const runtime = runtimeDouble();
    const summary = runtime.buildFallbackSummary(
      4,
      new Map([['src/app/layout.tsx', { path: 'src/app/layout.tsx' }]]),
      ['npm run lint'],
      baseArgs.messages,
    );
    expect(summary).toContain('Files changed: src/app/layout.tsx');
    expect(summary).toContain('Commands run: npm run lint');
    expect(summary).toContain('robots.txt: found at public/robots.txt');
  });

  it('warns when a changed script references a missing DOM id', async () => {
    const runtime = runtimeDouble();
    (runtime as unknown as { workspace: { readFile(path: string): Promise<{ content: string }> } }).workspace = {
      readFile: async (file) => ({
        content: file.endsWith('.html')
          ? '<div id="time-display"></div>'
          : "document.getElementById('session-counter');",
      }),
    };
    const changed = new Map<string, unknown>([['app.js', {}]]);

    const missing = await runtime.verifyDomReferences(changed, ['index.html']);
    expect(missing[0]).toContain('#session-counter');

    const complete = await runtime.verifyDomReferences(changed, ['index.html', 'counter.html']);
    expect(complete[0]).toContain('#session-counter');

    (runtime as unknown as { workspace: { readFile(path: string): Promise<{ content: string }> } }).workspace = {
      readFile: async () => ({ content: '<div id="session-counter"></div>' }),
    };
    expect(await runtime.verifyDomReferences(changed, ['index.html'])).toEqual([]);
  });

  it('detects reports that falsely deny writes', () => {
    expect(reportDeniesWrites('No edits were made due to step budget exhaustion.')).toBe(true);
    expect(reportDeniesWrites('I could not make any changes in this run.')).toBe(true);
    expect(reportDeniesWrites('Nothing was written because the tool failed.')).toBe(true);
    expect(reportDeniesWrites('Updated app.js, index.html and README.md with the counter.')).toBe(false);
    expect(reportDeniesWrites('The agent completed 16 steps but the model returned no final text.')).toBe(false);
  });
});

const READ_ONLY = new Set(['read_file', 'list_files', 'search_code', 'semantic_search']);
const call = (name: string): ChatToolCall => ({ id: `${name}-1`, name, arguments: {} });
const isReadOnly = (name: string) => READ_ONLY.has(name);

describe('planToolBatches', () => {
  it('groups consecutive read-only calls so they can run together', () => {
    const batches = planToolBatches(
      [call('read_file'), call('list_files'), call('search_code'), call('write_file'), call('read_file')],
      isReadOnly,
      true,
    );
    expect(batches.map((batch) => batch.map((entry) => entry.name))).toEqual([
      ['read_file', 'list_files', 'search_code'],
      ['write_file'],
      ['read_file'],
    ]);
  });

  it('keeps batches small enough to stay readable', () => {
    const calls = ['read_file', 'list_files', 'search_code', 'semantic_search', 'read_file'].map(call);
    const batches = planToolBatches(calls, isReadOnly, true);
    expect(batches.map((batch) => batch.length)).toEqual([4, 1]);
  });

  it('runs everything sequentially when parallel reads are off', () => {
    const batches = planToolBatches([call('read_file'), call('list_files')], isReadOnly, false);
    expect(batches.map((batch) => batch.length)).toEqual([1, 1]);
  });

  it('never batches a write with the reads around it', () => {
    const batches = planToolBatches([call('read_file'), call('write_file'), call('read_file')], isReadOnly, true);
    expect(batches.map((batch) => batch[0]?.name)).toEqual(['read_file', 'write_file', 'read_file']);
    expect(batches.every((batch) => batch.length === 1)).toBe(true);
  });
});
