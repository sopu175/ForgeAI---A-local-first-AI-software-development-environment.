/**
 * Some local models do not implement native tool calling. For those we prompt for a JSON
 * envelope and parse it here. This is intentionally forgiving: the same parser handles a
 * single call, an array of calls, and a final answer envelope.
 */
export interface ParsedEnvelope {
  calls: Array<{ name: string; arguments: Record<string, unknown> }>;
  final?: string;
}

function tryParse(candidate: string): ParsedEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return null;
  }
  return normalize(value);
}

function normalize(value: unknown): ParsedEnvelope | null {
  if (Array.isArray(value)) {
    const calls = value.map((item) => normalize(item)).flatMap((item) => item?.calls ?? []);
    return calls.length ? { calls } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.tools)) return normalize(record.tools);
  if (Array.isArray(record.calls)) return normalize(record.calls);
  const rawName = record.tool ?? record.name ?? record.action ?? record.function;
  const finalText =
    typeof record.final === 'string'
      ? record.final
      : typeof record.summary === 'string' && record.final !== false
        ? record.summary
        : typeof record.answer === 'string'
          ? record.answer
          : undefined;
  if (record.type === 'final' && typeof record.content === 'string') {
    return { calls: [], final: record.content };
  }
  if (typeof rawName === 'string') {
    const name = rawName.replace(/^functions\./, '');
    const argsRaw = record.arguments ?? record.args ?? record.input ?? record.parameters ?? {};
    let args: Record<string, unknown> = {};
    if (typeof argsRaw === 'string') {
      try {
        const parsed = JSON.parse(argsRaw) as unknown;
        if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
      } catch {
        args = { raw: argsRaw };
      }
    } else if (argsRaw && typeof argsRaw === 'object') {
      args = argsRaw as Record<string, unknown>;
    }
    return { calls: [{ name, arguments: args }], final: finalText };
  }
  if (finalText) return { calls: [], final: finalText };
  return null;
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const body = match[1]?.trim();
    if (body) candidates.push(body);
  }
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) candidates.push(trimmed);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  return candidates;
}

export function parseToolEnvelope(text: string): ParsedEnvelope | null {
  for (const candidate of extractJsonCandidates(text)) {
    const parsed = tryParse(candidate);
    if (parsed) return parsed;
  }
  return null;
}

/** Removes a JSON envelope from assistant prose so the chat shows only human-facing text. */
export function stripEnvelope(text: string): string {
  return text
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, (block) => {
      const parsed = tryParse(block.replace(/```(?:json)?/gi, '').trim());
      return parsed ? '' : block;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
