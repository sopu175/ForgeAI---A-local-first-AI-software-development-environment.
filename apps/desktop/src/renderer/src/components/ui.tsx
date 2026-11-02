import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  File,
  FileCode2,
  FileCog,
  FileImage,
  FileJson2,
  FileLock2,
  FileText,
  Info,
  X,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('spinner', className)} aria-label="Loading" />;
}

export function IconButton({
  children,
  label,
  onClick,
  active,
  disabled,
  className,
  title,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted transition-colors hover:bg-panel-3 hover:text-fg disabled:opacity-40',
        active && 'bg-panel-3 text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Modal({
  children,
  onClose,
  width = 560,
  className,
}: {
  children: ReactNode;
  onClose: () => void;
  width?: number | string;
  className?: string;
}) {
  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={cn('modal', className)} style={{ width }} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({
  title,
  subtitle,
  icon,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line-soft px-5 py-4">
      {icon ? <div className="mt-0.5 text-accent">{icon}</div> : null}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[14px] font-semibold text-fg-strong">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{subtitle}</p> : null}
      </div>
      {children}
      {onClose ? (
        <IconButton label="Close" onClick={onClose}>
          <X size={15} />
        </IconButton>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon ? <div className="mb-1 text-faint">{icon}</div> : null}
      <p className="text-[12.5px] font-medium text-fg">{title}</p>
      {description ? <p className="max-w-[280px] text-[11.5px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pb-1 pt-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</span>
      {right}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors',
        checked ? 'border-accent bg-accent' : 'border-line bg-panel-3',
      )}
    >
      <span
        className={cn(
          'absolute top-[1px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all',
          checked ? 'left-[15px]' : 'left-[1px]',
        )}
      />
    </button>
  );
}

export function StatusDot({ tone = 'muted' }: { tone?: 'muted' | 'success' | 'warning' | 'danger' | 'accent' }) {
  const colors = {
    muted: 'bg-faint',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    accent: 'bg-accent',
  };
  return <span className={cn('inline-block h-[6px] w-[6px] shrink-0 rounded-full', colors[tone])} />;
}

type Severity = 'error' | 'warning' | 'info';

export function SeverityIcon({ severity, size = 13 }: { severity: Severity; size?: number }) {
  if (severity === 'error') return <AlertTriangle size={size} className="text-danger" />;
  if (severity === 'warning') return <AlertTriangle size={size} className="text-warning" />;
  return <Info size={size} className="text-cyan" />;
}

export function ToastIcon({ kind }: { kind: 'info' | 'success' | 'error' }) {
  if (kind === 'error') return <AlertTriangle size={15} className="text-danger" />;
  if (kind === 'success') return <CheckCircle2 size={15} className="text-success" />;
  return <Info size={15} className="text-cyan" />;
}

const FILE_STYLES: Array<{ test: RegExp; icon: typeof File; color: string }> = [
  { test: /\.(tsx?|mts|cts)$/i, icon: FileCode2, color: '#60a5fa' },
  { test: /\.(jsx?|mjs|cjs)$/i, icon: FileCode2, color: '#facc15' },
  { test: /\.(json|jsonc|json5)$/i, icon: FileJson2, color: '#fbbf24' },
  { test: /\.(md|mdx|txt|rst)$/i, icon: FileText, color: '#519aba' },
  { test: /\.(css|scss|sass|less)$/i, icon: FileCode2, color: '#519aba' },
  { test: /\.(html?|vue|svelte|astro)$/i, icon: FileCode2, color: '#fb923c' },
  { test: /\.(php)$/i, icon: FileCode2, color: '#c084fc' },
  { test: /\.(py)$/i, icon: FileCode2, color: '#22d3ee' },
  { test: /\.(go)$/i, icon: FileCode2, color: '#22d3ee' },
  { test: /\.(rs)$/i, icon: FileCode2, color: '#fb923c' },
  { test: /\.(ya?ml|toml|ini|env)$/i, icon: FileCog, color: '#94a3b8' },
  { test: /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i, icon: FileImage, color: '#f472b6' },
  { test: /(^|\/)(package\.json|tsconfig.*\.json|composer\.json|Cargo\.toml)$/i, icon: FileJson2, color: '#f97316' },
  { test: /(^|\/)(\.env|.*\.pem|.*\.key|id_rsa)$/i, icon: FileLock2, color: '#f87171' },
];

export function fileStyle(path: string): { icon: typeof File; color: string } {
  for (const style of FILE_STYLES) {
    if (style.test.test(path)) return { icon: style.icon, color: style.color };
  }
  return { icon: File, color: '#8b95a7' };
}

export function FileTypeIcon({ path, size = 14 }: { path: string; size?: number }) {
  const style = fileStyle(path);
  const Icon = style.icon;
  return <Icon size={size} style={{ color: style.color }} className="shrink-0" />;
}

export function KeyHint({ keys }: { keys: string }) {
  return (
    <span className="rounded border border-line bg-panel-3 px-1.5 py-[1px] font-mono text-[10px] text-faint">
      {keys}
    </span>
  );
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'success' | 'warning' }) {
  const colors = { accent: 'bg-accent', success: 'bg-success', warning: 'bg-warning' };
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-panel-3">
      <div
        className={cn('h-full rounded-full transition-[width] duration-300', colors[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function TooltipLabel({ text }: { text: string }) {
  return (
    <span className="pointer-events-none absolute -top-7 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded border border-line bg-panel-3 px-2 py-1 text-[10px] text-fg opacity-0 shadow-soft transition-opacity group-hover:opacity-100">
      {text}
    </span>
  );
}
