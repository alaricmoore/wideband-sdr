/* Pure helper functions shared between the browser UI and the Node test suite.

   In the browser these are exposed as globals (loaded before app.js); in Node
   they are exported via module.exports so tests can require() them.
*/
(function (root) {
  "use strict";

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderInline(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) =>
      /^https?:\/\//i.test(url)
        ? `<a href="${url}" target="_blank" rel="noopener">${text}</a>`
        : text);
    return s;
  }

  function renderMarkdown(text) {
    if (!text) return "";
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push(list === "ul" ? "</ul>" : "</ol>"); list = null; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        closeList();
        const code = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
        out.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
        continue;
      }
      const h = line.match(/^\s*(#{1,6})\s+(.*)$/);
      if (h) { closeList(); out.push(`<h${h[1].length}>${renderInline(h[2])}</h${h[1].length}>`); continue; }
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) {
        if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
        out.push(`<li>${renderInline(ul[1])}</li>`);
        continue;
      }
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
        out.push(`<li>${renderInline(ol[1])}</li>`);
        continue;
      }
      if (line.trim() === "") { closeList(); continue; }
      closeList();
      out.push(`<p>${renderInline(line)}</p>`);
    }
    closeList();
    return out.join("\n");
  }

  function fmtHz(hz) {
    if (hz >= 1e6) return (hz / 1e6).toFixed(1) + "M";
    if (hz >= 1e3) return (hz / 1e3).toFixed(1) + "k";
    return hz + " Hz";
  }

  function parseOllamaUrl(url) {
    try {
      const u = new URL(url || "http://127.0.0.1:11434");
      return { host: u.hostname, port: u.port || "11434" };
    } catch (e) {
      return { host: "127.0.0.1", port: "11434" };
    }
  }

  const api = { escapeHtml, renderInline, renderMarkdown, fmtHz, parseOllamaUrl };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof self !== "undefined" ? self : globalThis);
