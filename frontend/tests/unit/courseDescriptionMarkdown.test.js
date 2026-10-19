import { describe, expect, it } from 'vitest';
import { renderCourseDescription } from '../../utils/courseDescriptionMarkdown.js';

describe('renderCourseDescription', () => {
  it('renders headings, paragraphs, and clickable resource links', () => {
    const html = renderCourseDescription('# Permission Systems\n\n[Slides](https://example.com/slides)');

    expect(html).toContain('<h3>Permission Systems</h3>');
    expect(html).toContain('href="https://example.com/slides"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('linkifies plain external URLs and opens them safely', () => {
    const html = renderCourseDescription('Slides: https://example.com/slides');

    expect(html).toContain('<a href="https://example.com/slides" target="_blank" rel="noopener noreferrer">');
  });

  it('does not render raw HTML or unsafe URL schemes', () => {
    const html = renderCourseDescription('<script>alert(1)</script>\n\n[Bad](javascript:alert(1))');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
  });

  it('returns no markup for an empty description', () => {
    expect(renderCourseDescription('  \n ')).toBe('');
    expect(renderCourseDescription(null)).toBe('');
  });
});
