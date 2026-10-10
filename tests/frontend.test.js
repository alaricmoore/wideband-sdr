const test = require("node:test");
const assert = require("node:assert");

const {
  escapeHtml,
  renderMarkdown,
  fmtHz,
  parseOllamaUrl,
} = require("../frontend/lib.js");

test("escapeHtml escapes HTML", () => {
  assert.strictEqual(escapeHtml("<b>&</b>"), "&lt;b&gt;&amp;&lt;/b&gt;");
});

test("renderMarkdown renders bold, inline code, lists, and links", () => {
  const html = renderMarkdown(
    "**bold** and `code`\n\n- one\n- two\n\n[site](https://example.com)"
  );
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<code>code</code>"));
  assert.ok(html.includes("<ul>"));
  assert.ok(html.includes('<a href="https://example.com" target="_blank"'));
});

test("renderMarkdown escapes raw HTML (XSS-safe)", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("renderMarkdown drops unsafe javascript: links", () => {
  const html = renderMarkdown("[click](javascript:alert(1))");
  assert.ok(!html.includes('href="javascript:'));
});

test("renderMarkdown handles fenced code blocks", () => {
  const html = renderMarkdown("```\n<>&\n```");
  assert.ok(html.includes("<pre><code>"));
  assert.ok(html.includes("&lt;&gt;&amp;"));
});

test("fmtHz formats hertz", () => {
  assert.strictEqual(fmtHz(100_000_000), "100.0M");
  assert.strictEqual(fmtHz(250_000), "250.0k");
  assert.strictEqual(fmtHz(500), "500 Hz");
});

test("parseOllamaUrl parses host and port", () => {
  assert.deepStrictEqual(
    parseOllamaUrl("http://192.168.1.5:11434"),
    { host: "192.168.1.5", port: "11434" }
  );
  assert.deepStrictEqual(
    parseOllamaUrl("http://192.168.1.5"),
    { host: "192.168.1.5", port: "11434" }
  );
});
