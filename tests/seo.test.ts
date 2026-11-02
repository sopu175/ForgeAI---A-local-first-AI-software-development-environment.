import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolContext } from '../apps/desktop/src/main/agent/tools';

const files = ['src/app/layout.tsx', 'src/app/page.tsx', 'next.config.ts', 'public/robots.txt'];
const contents: Record<string, string> = {
  'src/app/layout.tsx': 'export default function Layout() { return <html><body><h1>Weather</h1></body></html>; }',
  'src/app/page.tsx': 'export default function Page() { return <main>Forecast</main>; }',
  'next.config.ts': 'export default {};',
  'public/robots.txt': 'User-agent: *\nAllow: /\n',
};

function seoContext(): ToolContext {
  return {
    agent: 'seo',
    signal: new AbortController().signal,
    search: { files: async () => files },
    workspace: {
      readFile: async (path: string) => ({ path, content: contents[path] ?? '' }),
    },
  } as unknown as ToolContext;
}

describe('seo_audit', () => {
  it('treats "." as the project root instead of filtering everything out', async () => {
    const result = await new ToolRegistry().execute('seo_audit', { scope: '.' }, seoContext());
    expect(result.ok).toBe(true);
    expect(result.observation).toContain('robots.txt: found at public/robots.txt');
    expect(result.observation).toContain('### src/app/page.tsx');
  });

  it('checks page files for metadata without treating configs as pages', async () => {
    const result = await new ToolRegistry().execute('seo_audit', {}, seoContext());
    expect(result.observation).not.toContain('### next.config.ts');
    expect(result.observation).not.toContain('### public/robots.txt');
    expect(result.observation).toContain('config files: next.config.ts');
    expect(result.observation).toContain('Pages with an h1: 1/2');
  });
});
