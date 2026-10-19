import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

const defaultValidateLink = markdown.validateLink.bind(markdown);

// Keep relative links useful while limiting explicit URL schemes to the ones
// course descriptions need. markdown-it's validator also catches obfuscated
// javascript/data URLs before this allow-list is applied.
markdown.validateLink = (url) => {
  if (!defaultValidateLink(url)) return false;
  const scheme = String(url).match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
  return !scheme || ['http', 'https', 'mailto'].includes(scheme);
};

const defaultLinkOpen = markdown.renderer.rules.link_open
  || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet('href') || '';

  if (/^(?:https?:)?\/\//i.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }

  return defaultLinkOpen(tokens, index, options, env, self);
};

// The panel title is an h2, so author-entered Markdown headings begin at h3.
for (const rule of ['heading_open', 'heading_close']) {
  markdown.renderer.rules[rule] = (tokens, index, options, _env, self) => {
    const token = tokens[index];
    const level = Number(token.tag.slice(1));
    token.tag = `h${Math.min(level + 2, 6)}`;
    return self.renderToken(tokens, index, options);
  };
}

export function renderCourseDescription(description) {
  const source = String(description ?? '').trim();
  return source ? markdown.render(source) : '';
}
