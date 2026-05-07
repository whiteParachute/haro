import { useMemo, useState, type ReactNode } from 'react';

/**
 * GFM code block renderer (FEAT-034 R8 / D3 / AC9).
 *
 * - Detects language from the `language-<id>` className react-markdown emits;
 *   when the id is missing or unsupported we fall back to plain text and drop
 *   the language label / line numbers so the UI never displays fake info.
 * - Provides a copy button regardless of fallback state (D3 keeps the affordance).
 * - Auto-folds blocks longer than 50 lines (R8) with a one-click expand.
 */

const LINE_FOLD_THRESHOLD = 50;

// Languages we register with rehype-highlight in MarkdownRenderer; anything
// outside this list is treated as "no language detected" → fallback path.
const KNOWN_LANGUAGES = new Set([
  'bash',
  'shell',
  'sh',
  'yaml',
  'yml',
  'json',
  'javascript',
  'js',
  'typescript',
  'ts',
  'tsx',
  'jsx',
  'python',
  'py',
  'go',
  'rust',
  'rs',
  'java',
  'kotlin',
  'sql',
  'css',
  'scss',
  'html',
  'xml',
  'markdown',
  'md',
  'diff',
  'plaintext',
  'text',
]);

export interface CodeBlockProps {
  children?: ReactNode;
  className?: string;
  inline?: boolean;
}

export function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const text = childrenToString(children);
  if (inline) {
    return <code className="rounded bg-muted px-1 py-0.5 text-sm">{text}</code>;
  }
  const language = parseLanguage(className);
  const recognized = language !== null && KNOWN_LANGUAGES.has(language);
  const lines = text.replace(/\n$/, '').split('\n');
  return (
    <CodeBlockBody text={text} language={recognized ? language! : null} lines={lines}>
      {children}
    </CodeBlockBody>
  );
}

function CodeBlockBody({
  text,
  language,
  lines,
  children,
}: {
  text: string;
  language: string | null;
  lines: string[];
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const overflow = lines.length > LINE_FOLD_THRESHOLD;
  const visibleLines = useMemo(() => {
    if (!overflow || expanded) return lines;
    return lines.slice(0, LINE_FOLD_THRESHOLD);
  }, [lines, overflow, expanded]);

  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard might be unavailable in tests / restricted browsers — best
      // effort, don't crash the render.
    }
  };

  const showLineNumbers = language !== null;
  const codeContent =
    showLineNumbers && (!overflow || expanded) ? (
      children
    ) : (
      <span data-testid={language ? 'code-folded-body' : 'code-fallback-body'}>
        {visibleLines.join('\n')}
      </span>
    );

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-zinc-950 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs">
        {language ? <span className="font-mono uppercase text-zinc-400">{language}</span> : null}
        <button
          type="button"
          onClick={() => void onCopy()}
          className="ml-auto rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-700"
          aria-label={copied ? '已复制' : '复制代码'}
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className={language ? `hljs language-${language}` : undefined}>
          {showLineNumbers ? (
            <span className="grid grid-cols-[auto_1fr] gap-x-3">
              <NumberGutter count={visibleLines.length} />
              <span className="min-w-0 whitespace-pre">{codeContent}</span>
            </span>
          ) : (
            // Fallback path: no language label, no line numbers, just text +
            // copy button. Keeps the block readable when detection failed.
            codeContent
          )}
        </code>
      </pre>
      {overflow ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="block w-full bg-zinc-900 px-3 py-1.5 text-center text-xs text-zinc-400 hover:bg-zinc-800"
        >
          {expanded ? '收起代码' : `展开剩余 ${lines.length - LINE_FOLD_THRESHOLD} 行`}
        </button>
      ) : null}
    </div>
  );
}

function NumberGutter({ count }: { count: number }) {
  return (
    <span aria-hidden className="select-none text-right text-zinc-600">
      {Array.from({ length: count }, (_, idx) => (
        <span key={idx} className="block">
          {idx + 1}
        </span>
      ))}
    </span>
  );
}

function parseLanguage(className: string | undefined): string | null {
  if (!className) return null;
  const match = className.match(/language-([\w-]+)/);
  if (!match) return null;
  return match[1]!.toLowerCase();
}

function childrenToString(children: ReactNode): string {
  if (children === null || children === undefined || children === false) return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children))
    return children.map((child) => childrenToString(child as ReactNode)).join('');
  if (typeof children === 'object') {
    const maybeProps = children as unknown as { props?: { children?: ReactNode } };
    if (maybeProps.props && 'children' in maybeProps.props) {
      return childrenToString(maybeProps.props.children ?? '');
    }
  }
  return '';
}
