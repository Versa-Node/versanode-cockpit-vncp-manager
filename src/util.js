import React, { useContext } from "react";

import cockpit from 'cockpit';

import { debounce } from 'throttle-debounce';
import * as dfnlocales from 'date-fns/locale';
import { formatRelative } from 'date-fns';
const _ = cockpit.gettext;

export const DockerInfoContext = React.createContext();
export const useDockerInfo = () => useContext(DockerInfoContext);

export const WithDockerInfo = ({ value, children }) => {
    return (
        <DockerInfoContext.Provider value={value}>
            {children}
        </DockerInfoContext.Provider>
    );
};

// --- Class swap utilities with includeSelf support ---

function rewriteClassList(el, from, to, allowFn = null) {
  if (!el || !el.classList) return;
  const adds = [], removes = [];
  el.classList.forEach(cls => {
    if (!cls.startsWith(from)) return;
    if (allowFn && !allowFn(cls)) return;
    removes.push(cls);
    adds.push(to + cls.slice(from.length));
  });
  if (removes.length) {
    removes.forEach(c => el.classList.remove(c));
    adds.forEach(c => el.classList.add(c));
  }
}

/**
 * Recursively apply class swaps to an element and its descendants
 * @param {Element} root
 * @param {string} from
 * @param {string} to
 * @param {function} allowFn
 * @param {number} levels  -1 = all
 * @param {number} current
 * @param {boolean} includeSelf - whether to rewrite classes on the starting node
 */
function sweep(root, from, to, allowFn, levels = -1, current = 0, includeSelf = true) {
  if (!root) return;

  if (includeSelf) rewriteClassList(root, from, to, allowFn);

  // stop if depth reached
  if (levels === 0 || (levels > 0 && current >= levels)) return;

  for (const child of root.children) {
    // always process children
    rewriteClassList(child, from, to, allowFn);
    sweep(child, from, to, allowFn, levels, current + 1, true);
  }
}

/**
 * swapRules: [
 *   { selector, from, to, levels=-1, allow, includeSelf=true }
 * ]
 * styleRules: [{ selector, style: { ...cssProps } }]
 * isActive: optional ()=>boolean guard
 */
export function enableSelectorSwaps({ swapRules = [], styleRules = [], isActive = () => true } = {}) {
  const applyStyles = () => {
    styleRules.forEach(({ selector, style }) => {
      document.querySelectorAll(selector).forEach(el => Object.assign(el.style, style || {}));
    });
  };

  const sweepSelection = (anchor, rule) => {
    if (!anchor) return;
    if (typeof rule._apply === "function") {
      rule._apply(anchor);
      return;
    }
    const { from, to, levels = -1, allow, includeSelf = true } = rule;
    sweep(anchor, from, to, allow, levels, 0, includeSelf);
  };

  const applySwapsNow = (root = document, anchorPerRule = null) => {
    if (!isActive()) return;

    swapRules.forEach((rule) => {
      const { selector } = rule;

      const anchor = anchorPerRule?.get?.(rule);
      if (anchor) sweepSelection(anchor, rule);

      const nodes = (root === document)
        ? document.querySelectorAll(selector)
        : (root.querySelectorAll?.(selector) || []);
      nodes.forEach(node => sweepSelection(node, rule));
    });
  };

  // initial pass
  applySwapsNow();
  applyStyles();

  const obs = new MutationObserver(muts => {
    if (!isActive()) return;

    for (const m of muts) {
      if (m.type === 'childList' && m.addedNodes?.length) {
        m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;

          const anchorPerRule = new Map();
          swapRules.forEach(rule => {
            const { selector } = rule;
            const anc = n.closest?.(selector) || (n.matches?.(selector) ? n : null);
            if (anc) anchorPerRule.set(rule, anc);
          });

          applySwapsNow(n, anchorPerRule);
          applyStyles();
        });
      } else if (m.type === 'attributes' && m.attributeName === 'class') {
        swapRules.forEach(rule => {
          const anc = m.target.closest?.(rule.selector);
          if (anc) sweepSelection(anc, rule);
        });
      }
    }
  });

  obs.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  return () => obs.disconnect();
}



/**
 * Safely quote a string for /bin/sh so it can be embedded in a single command line.
 * - Always returns a single-quoted token (or "''" for empty).
 * - Single quotes inside are represented as: '\''  (end, escaped quote, reopen)
 *
 * Examples:
 *   shell_quote("abc")              -> 'abc'
 *   shell_quote("a b")              -> 'a b'
 *   shell_quote("a'b")              -> 'a'"'"'b'
 *   shell_quote("")                 -> ''
 */
export function shell_quote(s) {
    s = String(s ?? "");
    if (s.length === 0) return "''";
    // replace every ' with: '"'"'
    return "'" + s.replace(/'/g, `'\"'\"'`) + "'";
}

/**
 * Quote an array of args and join with spaces for a shell -c string.
 * Accepts strings/numbers; ignores null/undefined.
 */
export function shell_quote_all(args) {
    if (!Array.isArray(args)) args = [args];
    return args
        .filter(a => a !== undefined && a !== null)
        .map(a => shell_quote(String(a)))
        .join(" ");
}

// https://github.com/containers/podman/blob/main/libpod/define/containerstate.go
// "Restarting" comes from special handling of restart case in Application.updateContainer()
export const states = [_("Exited"), _("Paused"), _("Stopped"), _("Removing"), _("Configured"), _("Created"), _("Restart"), _("Running")];

export const fallbackRegistries = ["ghcr.io", "docker.io"];

export function debug(...args) {
    if (window.debugging === "all" || window.debugging?.includes("vncp"))
        console.debug("vncp", ...args);
}

export function truncate_id(id) {
    if (!id) {
        return "";
    }

    if (id.indexOf(":") !== -1)
        id = id.split(":")[1];

    return id.substr(0, 12);
}

export function localize_time(unix_timestamp) {
    if (unix_timestamp === undefined || isNaN(unix_timestamp))
        return "";
    const locale = (cockpit.language == "en") ? dfnlocales.enUS : dfnlocales[cockpit.language.replace('_', '')];
    return formatRelative(unix_timestamp * 1000, Date.now(), { locale });
}

export function format_cpu_usage(stats) {
    const cpu_usage = stats?.cpu_stats?.cpu_usage?.total_usage;
    const system_cpu_usage = stats?.cpu_stats?.system_cpu_usage;
    const precpu_usage = stats?.precpu_stats?.cpu_usage?.total_usage;
    const precpu_system_cpu_usage = stats?.precpu_stats?.system_cpu_usage;

    if (cpu_usage === undefined || isNaN(cpu_usage))
        return "";

    let cpu_percent = 0;
    if (precpu_usage !== undefined && precpu_system_cpu_usage !== undefined) {
        const cpu_delta = cpu_usage - precpu_usage;
        const system_delta = system_cpu_usage - precpu_system_cpu_usage;
        if (system_delta > 0 && cpu_delta > 0)
            cpu_percent = (cpu_delta / system_delta) * stats.cpu_stats.online_cpus * 100;
    }

    return [cpu_percent.toFixed(2) + "%", cpu_percent];
}

export function format_memory_and_limit(stats) {
    const usage = stats?.memory_stats?.usage;
    const limit = stats?.memory_stats?.limit;

    if (usage === undefined || isNaN(usage))
        return "";

    let mtext = "";
    let unit;
    let parts;
    if (limit) {
        parts = cockpit.format_bytes(limit, undefined, { separate: true });
        mtext = " / " + parts.join(" ");
        unit = parts[1];
    }

    if (usage) {
        parts = cockpit.format_bytes(usage, unit, { separate: true });
        if (mtext)
            return [_(parts[0] + mtext), usage];
        else
            return [_(parts.join(" ")), usage];
    } else {
        return ["", -1];
    }
}

/*
 * The functions quote_cmdline and unquote_cmdline implement
 * a simple shell-like quoting syntax.  They are used when letting the
 * user edit a sequence of words as a single string.
 *
 * When parsing, words are separated by whitespace.  Single and double
 * quotes can be used to protect a sequence of characters that
 * contains whitespace or the other quote character.  A backslash can
 * be used to protect any character.  Quotes can appear in the middle
 * of a word.
 */

export function quote_cmdline(words) {
    words = words || [];

    if (typeof words === 'string')
        words = words.split(' ');

    function is_whitespace(c) {
        return c == ' ';
    }

    function quote(word) {
        let text = "";
        let quote_char = "";
        let i;
        for (i = 0; i < word.length; i++) {
            if (word[i] == '\\' || word[i] == quote_char)
                text += '\\';
            else if (quote_char === "") {
                if (word[i] == "'" || is_whitespace(word[i]))
                    quote_char = '"';
                else if (word[i] == '"')
                    quote_char = "'";
            }
            text += word[i];
        }

        return quote_char + text + quote_char;
    }

    return words.map(quote).join(' ');
}

export function unquote_cmdline(text) {
    const words = [];
    let next;

    function is_whitespace(c) {
        return c == ' ';
    }

    function skip_whitespace() {
        while (next < text.length && is_whitespace(text[next]))
            next++;
    }

    function parse_word() {
        let word = "";
        let quote_char = null;

        while (next < text.length) {
            if (text[next] == '\\') {
                next++;
                if (next < text.length) {
                    word += text[next];
                }
            } else if (text[next] == quote_char) {
                quote_char = null;
            } else if (quote_char) {
                word += text[next];
            } else if (text[next] == '"' || text[next] == "'") {
                quote_char = text[next];
            } else if (is_whitespace(text[next])) {
                break;
            } else
                word += text[next];
            next++;
        }
        return word;
    }

    next = 0;
    skip_whitespace();
    while (next < text.length) {
        words.push(parse_word());
        skip_whitespace();
    }

    return words;
}

export function image_name(image) {
    return image.RepoTags.length > 0 ? image.RepoTags[0] : "<none>:<none>";
}

export function is_valid_container_name(name) {
    return /^[a-zA-Z0-9][a-zA-Z0-9_\\.-]*$/.test(name);
}

/* Clears a single field in validationFailed object.
 *
 * Arguments:
 *   - validationFailed (object): Object containing list of fields with validation error
 *   - key (string): Specified which field from validationFailed object is clear
 *   - onValidationChange (func)
 */
export const validationClear = (validationFailed, key, onValidationChange) => {
    if (!validationFailed)
        return;

    const delta = { ...validationFailed };
    delete delta[key];
    onValidationChange(delta);
};

// This method needs to be outside of component as re-render would create a new instance of debounce
export const validationDebounce = debounce(500, (validationHandler) => validationHandler());
