import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { cn } from './ui';

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

function CopyCode({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(textOf(children))
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          })
          .catch(() => undefined);
      }}
      className="absolute right-1.5 top-1.5 rounded border border-line bg-panel-3 p-1 text-faint opacity-0 transition-opacity hover:text-fg group-hover/pre:opacity-100"
      title="Copy code"
    >
      {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
    </button>
  );
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('markdown text-[12.5px] text-fg', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children: preChildren }) {
            return (
              <pre className="group/pre relative">
                <CopyCode>{preChildren}</CopyCode>
                {preChildren}
              </pre>
            );
          },
          a({ href, children: linkChildren }) {
            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  if (href && /^https?:\/\//.test(href)) void window.forge.app.openExternal(href);
                }}
                title={href}
              >
                {linkChildren}
              </a>
            );
          },
          table({ children: tableChildren }) {
            return (
              <div className="overflow-x-auto">
                <table>{tableChildren}</table>
              </div>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
