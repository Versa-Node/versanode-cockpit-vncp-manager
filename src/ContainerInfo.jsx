import React from "react";
import cockpit from "cockpit";

const _ = cockpit.gettext;
const DEFAULT_README_PATH = "/usr/share/versanode/README.md";

/* ----------------- tiny markdown -> React (safe subset) ----------------- */

function Inline({ text }) {
  // token order matters (links first to avoid eating their brackets)
  const tokens = [];
  let i = 0;

  const rx =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;

  let m;
  while ((m = rx.exec(text))) {
    const [full] = m;
    // text before match
    if (m.index > i) tokens.push(text.slice(i, m.index));

    if (m[1] && m[2]) {
      // [label](url)
      tokens.push(
        <a
          key={`a-${m.index}`}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
        >
          {m[1]}
        </a>
      );
    } else if (m[3]) {
      // `code`
      tokens.push(
        <code key={`code-${m.index}`} className="pf-v6-c-code">
          {m[3]}
        </code>
      );
    } else if (m[4]) {
      // **bold**
      tokens.push(<strong key={`b-${m.index}`}>{m[4]}</strong>);
    } else if (m[5]) {
      // *italic*
      tokens.push(<em key={`i-${m.index}`}>{m[5]}</em>);
    } else if (m[6]) {
      // _italic_
      tokens.push(<em key={`i2-${m.index}`}>{m[6]}</em>);
    }

    i = m.index + full.length;
  }

  if (i < text.length) tokens.push(text.slice(i));
  return <>{tokens}</>;
}

function Markdown({ source }) {
  // Simple line-based block parser with fenced code and lists
  const lines = source.replace(/\r\n?/g, "\n").split("\n");

  const out = [];
  let buf = []; // paragraph buffer
  let list = null; // accumulating <ul> items
  let fence = null; // { lang, lines[] }

  const flushParagraph = () => {
    if (buf.length) {
      const text = buf.join(" ").trim();
      if (text) out.push(<p key={`p-${out.length}`}><Inline text={text} /></p>);
      buf = [];
    }
  };

  const flushList = () => {
    if (list && list.items.length) {
      out.push(
        <ul key={`ul-${out.length}`}>
          {list.items.map((t, idx) => (
            <li key={`li-${out.length}-${idx}`}>
              <Inline text={t} />
            </li>
          ))}
        </ul>
      );
    }
    list = null;
  };

  const flushFence = () => {
    if (fence) {
      const code = fence.lines.join("\n");
      out.push(
        <pre key={`pre-${out.length}`}>
          <code>{code}</code>
        </pre>
      );
      fence = null;
    }
  };

  for (let raw of lines) {
    const line = raw;

    // In code fence?
    if (fence) {
      if (/^```/.test(line)) {
        flushFence();
      } else {
        fence.lines.push(line);
      }
      continue;
    }

    // Fence start
    const fm = line.match(/^```(\w+)?\s*$/);
    if (fm) {
      flushParagraph();
      flushList();
      fence = { lang: fm[1] || "", lines: [] };
      continue;
    }

    // Blank line: break paragraphs/lists
    if (/^\s*$/.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }

    // Heading
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      flushParagraph();
      flushList();
      const level = hm[1].length;
      const content = hm[2].trim();
      const H = `h${level}`;
      out.push(
        React.createElement(
          H,
          { key: `h-${out.length}` },
          <Inline text={content} />
        )
      );
      continue;
    }

    // Unordered list item
    const lm = line.match(/^\s*[-*+]\s+(.*)$/);
    if (lm) {
      flushParagraph();
      if (!list) list = { items: [] };
      list.items.push(lm[1]);
      continue;
    }

    // Otherwise accumulate paragraph
    buf.push(line.trim());
  }

  // End flush
  flushFence();
  flushParagraph();
  flushList();

  // PatternFly prose styles
  return <div className="pf-v6-c-content">{out}</div>;
}

/* --------------------------- ContainerInfo --------------------------- */

export default function ContainerInfo({ container, health }) {
  const [md, setMd] = React.useState("");
  const [err, setErr] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const readmePath =
    container?.Config?.Labels?.["io.versanode.vncp.readme.path"] ||
    DEFAULT_README_PATH;

  React.useEffect(() => {
    let cancelled = false;

    async function fetchReadme() {
      setLoading(true);
      setErr("");
      try {
        const out = await cockpit.spawn(
          ["docker", "exec", container.Id, "cat", readmePath],
          { superuser: "try", err: "message" }
        );
        if (!cancelled) setMd(out);
      } catch (e) {
        if (!cancelled) {
          setMd("");
          setErr(e?.message || String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchReadme();
    // Re-fetch when health changes (e.g., file appears later)
    return () => {
      cancelled = true;
    };
  }, [container?.Id, readmePath, health]);

  if (loading)
    return (
      <div
        className="pf-v6-c-skeleton"
        style={{ height: 16, width: 160, margin: "8px 0" }}
      />
    );

  if (err && !md)
    return <div className="pf-v6-c-helper-text pf-m-error">{err}</div>;

  if (!md) return <div className="pf-v6-c-helper-text">{_("No README found.")}</div>;

  return (
    <div className="vncp-readme">
      <Markdown source={md} />
    </div>
  );
}
