import { useCallback, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './CodeBlock';
import { ImageLightbox, type LightboxImage } from './ImageLightbox';

/**
 * GFM Markdown renderer (FEAT-034 R7 / R8 / R12 / G3).
 *
 * Pulls every `<img>` out of the rendered tree at parse time so the lightbox
 * gets a deterministic ordered list — the alternative (querying the DOM
 * post-render) breaks when react-window unmounts off-screen messages and
 * loses position when images stream in mid-render.
 */

export interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const images = useMemo(() => extractImages(content), [content]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const handleImageClick = useCallback(
    (src: string, alt?: string) => {
      const idx = images.findIndex((img) => img.src === src && (img.alt ?? '') === (alt ?? ''));
      setLightboxIndex(idx >= 0 ? idx : 0);
    },
    [images],
  );

  return (
    <div className="prose prose-sm prose-zinc max-w-none break-words dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true, detect: true }]]}
        components={{
          code: ({ inline, className, children, ...rest }: CodeProps) => (
            <CodeBlock inline={inline} className={className} {...rest}>
              {children}
            </CodeBlock>
          ),
          img: ({ src, alt }) => {
            if (!src) return null;
            return (
              <button
                type="button"
                className="cursor-zoom-in border-0 bg-transparent p-0"
                onClick={() => handleImageClick(String(src), alt ?? undefined)}
                aria-label={alt ?? '查看大图'}
              >
                <img
                  src={String(src)}
                  alt={alt ?? ''}
                  className="my-2 max-h-72 max-w-full rounded-md border border-border object-contain"
                  loading="lazy"
                />
              </button>
            );
          },
          a: ({ children, href, ...rest }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline-offset-2 hover:underline"
              {...rest}
            >
              {children}
            </a>
          ),
          table: ({ children, ...rest }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm" {...rest}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...rest }) => (
            <th className="border border-border bg-muted px-2 py-1 text-left font-medium" {...rest}>
              {children}
            </th>
          ),
          td: ({ children, ...rest }) => (
            <td className="border border-border px-2 py-1 align-top" {...rest}>
              {children}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      <ImageLightbox
        images={images}
        initialIndex={lightboxIndex ?? 0}
        open={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
      />
    </div>
  );
}

interface CodeProps {
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}

const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function extractImages(markdown: string): LightboxImage[] {
  const out: LightboxImage[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  // Reset lastIndex defensively — RegExp with /g preserves state across calls.
  IMAGE_REGEX.lastIndex = 0;
  while ((match = IMAGE_REGEX.exec(markdown)) !== null) {
    const alt = match[1] ?? '';
    const src = match[2];
    if (!src) continue;
    const key = `${src}|${alt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alt ? { src, alt } : { src });
  }
  return out;
}

export const __test__ = { extractImages };
