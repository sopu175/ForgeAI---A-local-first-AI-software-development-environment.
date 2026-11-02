export function bytes(value: number | undefined): string {
  if (!value || value <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index <= 0 ? '' : path.slice(0, index);
}

export function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 8_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return `${Math.floor(delta / 1000)}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour12: false });
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  // Electron prefixes IPC failures with the channel name.
  return raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '').trim();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function compactPath(path: string, max = 48): string {
  if (path.length <= max) return path;
  const parts = path.split('/');
  if (parts.length <= 2) return `…${path.slice(-(max - 1))}`;
  return `${parts[0]}/…/${parts.slice(-2).join('/')}`;
}

export function lineSummary(additions: number, deletions: number): string {
  return `+${additions} −${deletions}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function shortModelName(model: string): string {
  return model.replace(/:latest$/, '').replace(/^hf\.co\//, '');
}
