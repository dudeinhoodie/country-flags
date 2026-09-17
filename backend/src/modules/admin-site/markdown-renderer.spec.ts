import { renderMarkdown } from "./markdown-renderer";

describe("renderMarkdown", () => {
  it("renders the structure a policy is written in", () => {
    const html = renderMarkdown(
      [
        "## Accounts",
        "",
        "An account is **optional**. Write to [us](mailto:hello@example.test).",
        "",
        "- one",
        "- two",
        "",
        "> quoted",
      ].join("\n"),
    );
    expect(html).toContain("<h2>Accounts</h2>");
    expect(html).toContain("<strong>optional</strong>");
    expect(html).toContain('href="mailto:hello@example.test"');
    expect(html).toContain("<ul>");
    expect(html).toContain("<blockquote>");
  });

  it("never passes raw HTML through", () => {
    const html = renderMarkdown(
      'Before <script>alert(1)</script> after <a href="x" onclick="y">z</a>',
    );
    // Escaped as text, not passed through as markup: the reader sees the
    // angle brackets, the browser never sees an element.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('<a href="x"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(
      "&lt;a href=&quot;x&quot; onclick=&quot;y&quot;&gt;",
    );
  });

  it("marks every link noopener and leaves the target to the browser", () => {
    const html = renderMarkdown("See [the terms](https://example.test/terms).");
    expect(html).toContain('rel="noopener"');
    expect(html).not.toContain("target=");
  });

  it("turns a bare address into a link", () => {
    const html = renderMarkdown("Questions: hello@example.test");
    expect(html).toContain('href="mailto:hello@example.test"');
  });
});
