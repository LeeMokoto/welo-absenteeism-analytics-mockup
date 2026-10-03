/*
  Minimal, dependency-free markdown renderer for agent output. Supports
  headings, bold, unordered and ordered lists, and paragraphs. It renders text
  only (no raw HTML), so agent output cannot inject markup.
*/

function renderInline(text, keyBase) {
  // Split on **bold** spans.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={`${keyBase}-b${i}`}>{p.slice(2, -2)}</strong>;
    }
    return <span key={`${keyBase}-t${i}`}>{p}</span>;
  });
}

export default function Markdown({ text }) {
  const lines = (text || "").split("\n");
  const blocks = [];
  let list = null; // { ordered, items: [] }

  const flushList = () => {
    if (list) {
      const items = list.items.map((it, i) => (
        <li key={`li-${blocks.length}-${i}`}>{renderInline(it, `li-${blocks.length}-${i}`)}</li>
      ));
      blocks.push(
        list.ordered ? (
          <ol key={`ol-${blocks.length}`}>{items}</ol>
        ) : (
          <ul key={`ul-${blocks.length}`}>{items}</ul>
        )
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList();
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const level = h[1].length;
      const Tag = `h${Math.min(4, level + 2)}`;
      blocks.push(
        <Tag key={`h-${blocks.length}`} style={{ fontSize: 15, margin: "10px 0 6px" }}>
          {renderInline(h[2], `h-${blocks.length}`)}
        </Tag>
      );
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ol) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    if (ul) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    flushList();
    blocks.push(
      <p key={`p-${blocks.length}`}>{renderInline(line, `p-${blocks.length}`)}</p>
    );
  }
  flushList();
  return <>{blocks}</>;
}
