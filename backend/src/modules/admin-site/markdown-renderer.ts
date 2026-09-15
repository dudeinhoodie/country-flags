import MarkdownIt from "markdown-it";

/**
 * The one Markdown renderer the site's documents go through.
 *
 * Rendered here, at publish time, rather than in the site: the site then
 * carries no Markdown implementation, the console's preview is the same
 * call, and the HTML a version was published with is what the version keeps.
 *
 * `html: false` is the load-bearing option. The text is written by admins,
 * but a document that could carry raw markup could carry a script, and the
 * page it lands on is the one the App Store review opens. Everything a
 * policy needs — headings, paragraphs, lists, links, emphasis, quotes,
 * tables — Markdown already says.
 */
const renderer = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

// Every link opens off the site's origin — a mail address or another
// site — and a link that navigates the reader out of a policy should at
// least not hand the opener over. `noopener` is the whole of it: no target
// is set, so the reader's own browser decides where the page opens.
const defaultLinkOpen =
  renderer.renderer.rules.link_open ??
  ((tokens, index, options, _env, self): string =>
    self.renderToken(tokens, index, options));
renderer.renderer.rules.link_open = (
  tokens,
  index,
  options,
  env,
  self,
): string => {
  tokens[index]?.attrJoin("rel", "noopener");
  return defaultLinkOpen(tokens, index, options, env, self);
};

export function renderMarkdown(markdown: string): string {
  return renderer.render(markdown);
}
