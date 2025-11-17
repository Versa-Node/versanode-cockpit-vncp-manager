// Enhanced Markdown Viewer with improved README styling
import React, { useMemo, useRef } from "react";
import { OutlinedQuestionCircleIcon } from "@patternfly/react-icons";
import "./MarkdownViewer.css";

// --- utils ---
const isHttpUrl = (s = "") => /^https?:\/\/[^\s)]+$/i.test(s);
const isImageUrl = (url = "") => {
  if (!url) return false;
  // Support common image file extensions
  return /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|ico)(\?[^\s)]*)?$/i.test(url) || isHttpUrl(url);
};
const slugify = (s = "") =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

function UniqueSlugger() {
  const used = new Map();
  return (text) => {
    const base = slugify(text);
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

// --- INLINE PARSER ---
// Supports: [text](url), ![alt](url "title"), `code`, **bold**, *emphasis*, _emphasis_,
// ~~strike~~, raw autolink http(s)://..., HTML <img> tags, mixes safely.
function Inline({ text }) {
  if (!text) return null;
  
  // First, let's handle HTML img tags by converting them to a special marker
  let processedText = text;
  const imgElements = [];
  
  processedText = processedText.replace(/<img\s+([^>]*?)\s*\/?>/gi, (match, attrs) => {
    const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
    const altMatch = attrs.match(/alt\s*=\s*["']([^"']*)["']/i);
    const titleMatch = attrs.match(/title\s*=\s*["']([^"']*)["']/i);
    const widthMatch = attrs.match(/width\s*=\s*["']?([^"'\s>]+)["']?/i);
    const heightMatch = attrs.match(/height\s*=\s*["']?([^"'\s>]+)["']?/i);
    
    const src = srcMatch ? srcMatch[1] : '';
    const alt = altMatch ? altMatch[1] : '';
    const title = titleMatch ? titleMatch[1] : '';
    const width = widthMatch ? widthMatch[1] : '';
    const height = heightMatch ? heightMatch[1] : '';
    
    if (src && (isHttpUrl(src) || isImageUrl(src))) {
      const style = {
        maxWidth: '100%',
        height: 'auto'
      };
      
      // Apply width/height if specified
      if (width) {
        style.width = width.includes('%') ? width : (width.includes('px') ? width : `${width}px`);
      }
      if (height) {
        style.height = height.includes('%') ? height : (height.includes('px') ? height : `${height}px`);
      }
      
      const imgElement = React.createElement('img', {
        src: src,
        alt: alt,
        title: title || undefined,
        loading: 'lazy',
        className: 'md-img',
        style: style
      });
      
      const placeholder = `__HTML_IMG_${imgElements.length}__`;
      imgElements.push(imgElement);
      return placeholder;
    }
    
    return match; // Keep original if not a valid image
  });
  
  // Now process the rest with standard markdown
  const tokens = [];
  let i = 0;

  // Order matters (more specific first)
  const rx = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"([^"]*)")?\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_|(https?:\/\/[^\s)]+)|__HTML_IMG_(\d+)__/g;

  let m;
  while ((m = rx.exec(processedText))) {
    const [full] = m;
    if (m.index > i) tokens.push(processedText.slice(i, m.index));

    if (m[11] !== undefined) {
      // HTML image placeholder
      const imgIndex = parseInt(m[11]);
      if (imgElements[imgIndex]) {
        tokens.push(React.cloneElement(imgElements[imgIndex], { key: `html-img-${m.index}` }));
      }
    } else if (m[1] !== undefined && m[2]) {
      // image ![alt](url "title")
      const alt = m[1];
      const url = m[2];
      const title = m[3];
      if (isHttpUrl(url) || isImageUrl(url)) {
        tokens.push(
          <img
            key={`img-${m.index}`}
            src={url}
            alt={alt}
            title={title || undefined}
            loading="lazy"
            className="md-img"
            style={{ maxWidth: '100%', height: 'auto' }}
            onError={(e) => {
              e.target.style.display = 'none';
              // Show alt text if image fails to load
              e.target.insertAdjacentHTML('afterend', `<span style="color: #888; font-style: italic;">[Image: ${alt || 'Image failed to load'}]</span>`);
            }}
          />
        );
      } else {
        tokens.push(full);
      }
    } else if (m[4] && m[5]) {
      // link
      const label = m[4];
      const url = m[5];
      if (isHttpUrl(url)) {
        tokens.push(
          <a
            key={`a-${m.index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </a>
        );
      } else {
        tokens.push(label);
      }
    } else if (m[6]) {
      tokens.push(<code key={`code-${m.index}`}>{m[6]}</code>);
    } else if (m[7]) {
      tokens.push(<strong key={`b-${m.index}`}>{m[7]}</strong>);
    } else if (m[8]) {
      tokens.push(<del key={`s-${m.index}`}>{m[8]}</del>);
    } else if (m[9]) {
      tokens.push(<em key={`i-${m.index}`}>{m[9]}</em>);
    } else if (m[10]) {
      tokens.push(<em key={`i2-${m.index}`}>{m[10]}</em>);
    } else if (m[11]) {
      const url = m[11];
      tokens.push(
        <a
          key={`al-${m.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {url}
        </a>
      );
    }
    i = m.index + full.length;
  }
  if (i < processedText.length) tokens.push(processedText.slice(i));
  return <>{tokens}</>;
}

// --- BLOCK PARSER ---
// Adds: headings+anchors, fenced code with lang + copy button, tables, lists, task lists, paragraphs.
export function Markdown({
  source = "",
  className = "",
  showTOC = false,
  maxTOCLevel = 3,
}) {
  const slug = useMemo(() => UniqueSlugger(), []);
  const tocRef = useRef([]);

  const tree = useMemo(() => {
    const out = [];
    tocRef.current = [];

    const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");

    let i = 0;
    let para = [];
    let ulist = null; // {items:[{raw,lineType:'ul'|'ol'|'task',checked?:bool}]}
    let olist = null; // same shape
    let table = null; // {header:[], rows:[]}
    let fence = null; // {lang, lines:[]}

    const flushPara = () => {
      if (!para.length) return;
      const text = para.join(" ").trim();
      if (text) {
        out.push(
          <p key={`p-${out.length}`}>
            <Inline text={text} />
          </p>
        );
      }
      para = [];
    };
    const flushLists = () => {
      if (ulist) {
        out.push(
          <ul key={`ul-${out.length}`}>
            {ulist.items.map((it, idx) => {
              if (it.lineType === "task") {
                return (
                  <li key={`li-${out.length}-${idx}`} className="md-task">
                    <input
                      type="checkbox"
                      checked={!!it.checked}
                      readOnly
                      disabled
                    />
                    <span>
                      <Inline text={it.raw} />
                    </span>
                  </li>
                );
              }
              return (
                <li key={`li-${out.length}-${idx}`}>
                  <Inline text={it.raw} />
                </li>
              );
            })}
          </ul>
        );
        ulist = null;
      }
      if (olist) {
        out.push(
          <ol key={`ol-${out.length}`}>
            {olist.items.map((it, idx) => (
              <li key={`oli-${out.length}-${idx}`}>
                <Inline text={it.raw} />
              </li>
            ))}
          </ol>
        );
        olist = null;
      }
    };
    const flushTable = () => {
      if (!table) return;
      out.push(
        <div key={`tblwrap-${out.length}`} className="md-table-wrap">
          <table className="pf-v6-c-table pf-m-compact md-table" role="table">
            {table.header.length ? (
              <thead>
                <tr role="row">
                  {table.header.map((h, k) => (
                    <th key={`th-${k}`} role="columnheader">
                      <Inline text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={`tr-${r}`} role="row">
                  {row.map((cell, c) => (
                    <td key={`td-${r}-${c}`} role="cell">
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      table = null;
    };
    const flushFence = () => {
      if (!fence) return;
      const code = fence.lines.join("\n");
      const lang = fence.lang ? String(fence.lang).toLowerCase() : "";
      const cls = lang ? `language-${lang}` : undefined;

      const handleCopy = async (e) => {
        try {
          await navigator.clipboard?.writeText(code);
          const btn = e.target;
          const originalText = btn.textContent;
          btn.textContent = 'Copied!';
          btn.style.background = '#28a745';
          btn.style.color = 'white';
          setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
            btn.style.color = '';
          }, 2000);
        } catch (err) {
          console.warn('Failed to copy code:', err);
          // Fallback for older browsers
          try {
            const textArea = document.createElement('textarea');
            textArea.value = code;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            
            const btn = e.target;
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
              btn.textContent = originalText;
            }, 2000);
          } catch (fallbackErr) {
            console.warn('Fallback copy also failed:', fallbackErr);
          }
        }
      };

      out.push(
        <div key={`prewrap-${out.length}`} className="md-codeblock">
          <button
            type="button"
            className="md-copy-btn"
            aria-label="Copy code to clipboard"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            Copy
          </button>
          <pre>
            <code className={cls}>{code}</code>
          </pre>
        </div>
      );
      fence = null;
    };
    const flushAll = () => {
      flushFence();
      flushPara();
      flushLists();
      flushTable();
    };

    const tryStartTable = (idx) => {
      // header row must have pipes and next row must be --- style
      const headerLine = lines[idx];
      const sepLine = lines[idx + 1];
      if (
        headerLine != null &&
        sepLine != null &&
        /\|/.test(headerLine) &&
        /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(sepLine)
      ) {
        const header = headerLine
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((s) => s.trim());
        table = { header, rows: [] };
        i = idx + 2;
        // absorb body rows until blank or non-pipe
        while (i < lines.length && /\|/.test(lines[i])) {
          const row = lines[i]
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((s) => s.trim());
          table.rows.push(row);
          i += 1;
        }
        i -= 1; // main loop will i++
        flushPara();
        flushLists();
        return true;
      }
      return false;
    };

    for (i = 0; i < lines.length; i++) {
      const raw = lines[i];

      // code fence
      if (fence) {
        if (/^```/.test(raw)) {
          flushFence();
        } else {
          fence.lines.push(raw);
        }
        continue;
      }
      const fenceOpen = raw.match(/^```(\w+)?\s*$/);
      if (fenceOpen) {
        flushAll();
        fence = { lang: fenceOpen[1] || "", lines: [] };
        continue;
      }

      // table
      if (!table && tryStartTable(i)) {
        continue;
      }

      // blank line -> flush paragraphs/lists, but keep reading
      if (/^\s*$/.test(raw)) {
        flushFence(); // just in case
        flushPara();
        flushLists();
        flushTable();
        continue;
      }

      // headings
      const hm = raw.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        flushAll();
        const level = hm[1].length;
        const text = hm[2].trim();
        const id = slug(text);
        if (level <= maxTOCLevel) {
          tocRef.current.push({ level, id, text });
        }
        const H = `h${level}`;
        out.push(
          React.createElement(
            H,
            { key: `h-${out.length}`, id, className: "md-heading" },
            <>
              <a href={`#${id}`} className="md-anchor" aria-label="Anchor link">
                #
              </a>{" "}
              <Inline text={text} />
            </>
          )
        );
        continue;
      }

      // unordered list, incl. task items
      const lm = raw.match(/^\s*[-*+]\s+(.*)$/);
      if (lm) {
        const body = lm[1];
        const task = body.match(/^\[( |x|X)\]\s+(.*)$/);
        if (!ulist) ulist = { items: [] };
        if (task) {
          ulist.items.push({
            lineType: "task",
            checked: task[1].toLowerCase() === "x",
            raw: task[2],
          });
        } else {
          ulist.items.push({ lineType: "ul", raw: body });
        }
        continue;
      }

      // ordered list
      const om = raw.match(/^\s*\d+\.\s+(.*)$/);
      if (om) {
        if (!olist) olist = { items: [] };
        olist.items.push({ lineType: "ol", raw: om[1] });
        continue;
      }

      // accumulate paragraph
      para.push(raw.trim());
    }

    flushAll();
    return out;
  }, [source, maxTOCLevel, slug]);

  return (
    <div className={`pf-v6-c-content md-root ${className || ""}`}>
      {showTOC && tocRef.current.length > 0 && (
        <nav className="md-toc" aria-label="Table of contents">
          <div className="md-toc__title">Contents</div>
          <ul>
            {tocRef.current.map((t, i) => (
              <li key={`toc-${i}`} className={`lv-${t.level}`}>
                <a href={`#${t.id}`}>{t.text}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {tree}
    </div>
  );
}
