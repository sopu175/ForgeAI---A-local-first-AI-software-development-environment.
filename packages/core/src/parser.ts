import { basename, languageFromPath } from '@forgeai/shared';
import type { SymbolInfo } from '@forgeai/shared';

/**
 * Parser abstraction. The default implementation is a fast, line-oriented extractor that works for
 * the languages ForgeAI supports out of the box and requires no native ABI. A Tree-sitter based
 * parser can implement this interface and be injected without touching indexers or retrievers.
 */
export interface CodeParser {
  readonly name: string;
  extractSymbols(path: string, content: string): SymbolInfo[];
}

type Pattern = { kind: string; regex: RegExp; containerGroup?: number };

const JS_TS_PATTERNS: Pattern[] = [
  { kind: 'class', regex: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'interface', regex: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'type', regex: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/ },
  { kind: 'enum', regex: /^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  {
    kind: 'function',
    regex: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  },
  {
    kind: 'function',
    regex:
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  },
  {
    kind: 'method',
    regex:
      /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\([^)]*\)\s*(?::\s*[^={]+)?\s*\{/,
  },
];

const PATTERN_SETS: Record<string, Pattern[]> = {
  typescript: JS_TS_PATTERNS,
  javascript: JS_TS_PATTERNS,
  python: [
    { kind: 'class', regex: /^\s*class\s+([A-Za-z_]\w*)/ },
    { kind: 'function', regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/ },
  ],
  go: [
    { kind: 'function', regex: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/ },
    { kind: 'type', regex: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/ },
  ],
  rust: [
    { kind: 'function', regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/ },
    { kind: 'struct', regex: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/ },
    { kind: 'enum', regex: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/ },
    { kind: 'trait', regex: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/ },
    { kind: 'impl', regex: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([A-Za-z_]\w*)/ },
  ],
  php: [
    { kind: 'class', regex: /^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/ },
    { kind: 'interface', regex: /^\s*interface\s+([A-Za-z_]\w*)/ },
    { kind: 'trait', regex: /^\s*trait\s+([A-Za-z_]\w*)/ },
    { kind: 'function', regex: /^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+([A-Za-z_]\w*)/ },
  ],
  ruby: [
    { kind: 'class', regex: /^\s*class\s+([A-Za-z_]\w*)/ },
    { kind: 'module', regex: /^\s*module\s+([A-Za-z_]\w*)/ },
    { kind: 'method', regex: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/ },
  ],
  java: [
    {
      kind: 'class',
      regex: /^\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/,
    },
    { kind: 'interface', regex: /^\s*(?:public\s+)?interface\s+([A-Za-z_]\w*)/ },
    { kind: 'enum', regex: /^\s*(?:public\s+)?enum\s+([A-Za-z_]\w*)/ },
    {
      kind: 'method',
      regex:
        /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|synchronized\s+|abstract\s+)+[\w<>[\],.? ]+\s+([A-Za-z_]\w*)\s*\(/,
    },
  ],
  csharp: [
    {
      kind: 'class',
      regex: /^\s*(?:public\s+|internal\s+|private\s+)?(?:abstract\s+|sealed\s+|static\s+)?class\s+([A-Za-z_]\w*)/,
    },
    { kind: 'interface', regex: /^\s*(?:public\s+)?interface\s+([A-Za-z_]\w*)/ },
    {
      kind: 'method',
      regex:
        /^\s*(?:public|private|protected|internal|static|async|virtual|override|\s)+[\w<>[\],.? ]+\s+([A-Za-z_]\w*)\s*\(/,
    },
  ],
  kotlin: [
    { kind: 'class', regex: /^\s*(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+([A-Za-z_]\w*)/ },
    { kind: 'function', regex: /^\s*(?:suspend\s+)?fun\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)/ },
  ],
  swift: [
    { kind: 'class', regex: /^\s*(?:public\s+|private\s+|internal\s+)?(?:final\s+)?class\s+([A-Za-z_]\w*)/ },
    { kind: 'struct', regex: /^\s*(?:public\s+|private\s+|internal\s+)?struct\s+([A-Za-z_]\w*)/ },
    { kind: 'function', regex: /^\s*(?:public\s+|private\s+|internal\s+)?(?:static\s+)?func\s+([A-Za-z_]\w*)/ },
  ],
  c: [
    { kind: 'function', regex: /^(?:[\w*&]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?$/ },
    { kind: 'struct', regex: /^\s*(?:typedef\s+)?struct\s+([A-Za-z_]\w*)/ },
  ],
  cpp: [
    { kind: 'class', regex: /^\s*(?:template\s*<[^>]*>\s*)?class\s+([A-Za-z_]\w*)/ },
    { kind: 'struct', regex: /^\s*(?:template\s*<[^>]*>\s*)?struct\s+([A-Za-z_]\w*)/ },
    { kind: 'function', regex: /^(?:[\w*&:<>,]+\s+)+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{?$/ },
  ],
};

export class HeuristicParser implements CodeParser {
  readonly name = 'heuristic';

  extractSymbols(path: string, content: string): SymbolInfo[] {
    const language = languageFromPath(path);
    const patterns = PATTERN_SETS[language];
    if (!patterns) return [];
    const symbols: SymbolInfo[] = [];
    const lines = content.split(/\r?\n/);
    let currentClass: string | undefined;
    let classIndent = -1;
    // For brace-counted languages (Go, Rust, Java, C#, etc.) track nesting depth
    // so we can tell when we leave a class/struct scope.
    const isIndentLanguage = language === 'python' || language === 'ruby';
    const isBraceLanguage = !isIndentLanguage && language !== 'typescript' && language !== 'javascript';
    let braceDepth = 0;
    let classStartDepth = -1;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line.length > 400) continue;

      // --- Container scope tracking ---
      if (isIndentLanguage) {
        // Python/Ruby: use indentation to detect when we leave the class body.
        const indent = line.length - line.trimStart().length;
        if (currentClass && indent <= classIndent && line.trim().length > 0) {
          currentClass = undefined;
          classIndent = -1;
        }
      } else if (isBraceLanguage) {
        // Go, Rust, Java, C#, C, C++: count braces to track scope exit.
        for (const char of line) {
          if (char === '{') braceDepth += 1;
          else if (char === '}') {
            braceDepth -= 1;
            if (currentClass && braceDepth <= classStartDepth) {
              currentClass = undefined;
              classStartDepth = -1;
            }
          }
        }
      } else {
        // JS/TS: original indent-based heuristic.
        const indent = line.length - line.trimStart().length;
        if (currentClass && indent <= classIndent && line.trim().length > 0) {
          currentClass = undefined;
          classIndent = -1;
        }
      }

      for (const pattern of patterns) {
        const match = pattern.regex.exec(line);
        if (!match?.[1]) continue;
        const name = match[1];
        if (['if', 'for', 'while', 'switch', 'catch', 'return', 'constructor'].includes(name)) continue;
        const isClassLike =
          pattern.kind === 'class' ||
          pattern.kind === 'interface' ||
          pattern.kind === 'struct' ||
          pattern.kind === 'trait' ||
          pattern.kind === 'impl';
        const isMethod = pattern.kind === 'method' || pattern.kind === 'function';
        if (isClassLike) {
          currentClass = name;
          if (isIndentLanguage) {
            classIndent = line.length - line.trimStart().length;
          } else if (isBraceLanguage) {
            // The opening brace may be on this line or the next; record current depth
            // before this line's braces were counted so exit detection is correct.
            classStartDepth = braceDepth - (line.split('{').length - 1) + (line.split('}').length - 1);
            if (classStartDepth < 0) classStartDepth = 0;
          } else {
            classIndent = line.length - line.trimStart().length;
          }
        }
        symbols.push({
          name,
          kind: pattern.kind,
          line: index + 1,
          path,
          container: isMethod ? currentClass : undefined,
        });
        break;
      }
      if (symbols.length > 6000) break;
    }
    return symbols;
  }
}

export const defaultParser: CodeParser = new HeuristicParser();

export function symbolSummary(symbols: SymbolInfo[]): string {
  return symbols
    .map((symbol) => `${symbol.kind} ${symbol.container ? `${symbol.container}.` : ''}${symbol.name} (L${symbol.line})`)
    .join('\n');
}

export function detectSymbolsFromImports(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(/(?:import|require)\s*(?:\([^)]*\)|[\s\S]*?from\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/')) {
      names.push(specifier);
    }
  }
  return [...new Set(names)];
}

export function isTestFile(path: string): boolean {
  return /(^|[\\./])(test|tests|spec|__tests__|e2e)([\\./]|$)/i.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path);
}

export function isLikelyConfig(path: string): boolean {
  return (
    /(^|\/)(package\.json|tsconfig[^/]*\.json|vite\.config\.[jt]s|next\.config\.[jm]s|composer\.json|go\.mod|Cargo\.toml|pyproject\.toml|requirements\.txt|Dockerfile|docker-compose[^/]*\.ya?ml)$/i.test(
      path,
    ) || basename(path).startsWith('.env')
  );
}
