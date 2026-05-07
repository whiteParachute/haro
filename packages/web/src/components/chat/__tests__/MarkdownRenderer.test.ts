import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { __test__, MarkdownRenderer } from '../MarkdownRenderer';

describe('MarkdownRenderer.extractImages', () => {
  it('parses a single image with alt', () => {
    const out = __test__.extractImages('![diagram](https://example.com/a.png)');
    expect(out).toEqual([{ src: 'https://example.com/a.png', alt: 'diagram' }]);
  });

  it('preserves order across multiple images', () => {
    const text = '![a](u1) middle ![b](u2)\n![c](u3)';
    const out = __test__.extractImages(text);
    expect(out.map((image) => image.src)).toEqual(['u1', 'u2', 'u3']);
  });

  it('deduplicates identical src + alt pairs', () => {
    const text = '![x](u1) ![x](u1) ![x2](u1)';
    const out = __test__.extractImages(text);
    expect(out).toHaveLength(2);
  });

  it('returns empty list when content has no images', () => {
    expect(__test__.extractImages('# heading\nplain text')).toEqual([]);
  });

  it('keeps highlighted spans for recognised code blocks', () => {
    const html = renderToString(
      createElement(MarkdownRenderer, { content: '```js\nconst answer = 1\n```' }),
    );
    expect(html).toContain('hljs');
    expect(html).toContain('language-js');
    expect(html).toContain('hljs-keyword');
  });

  it('falls back without fake language label or line numbers for unknown code blocks', () => {
    const html = renderToString(
      createElement(MarkdownRenderer, { content: '```definitelyunknown\nx = 1\n```' }),
    );
    expect(html).toContain('data-testid="code-fallback-body"');
    expect(html).not.toContain('code-fallback-label');
    expect(html).not.toContain('language-definitelyunknown');
  });
});
