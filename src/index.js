import "cockpit-dark-theme";
import React from "react";
import { createRoot } from "react-dom/client";
import "patternfly/patternfly-5-cockpit.scss";
import Application from "./app.jsx";
import "./docker.scss";
import { enableSelectorSwaps } from "./util.js";

/* =========================
   Env helpers for reload
   ========================= */

function readEnv(name, fallback) {
  // Runtime override (put values in window.__VNCP_ENV = { KEY: "value" })
  const winVal = typeof window !== "undefined" && window.__VNCP_ENV && window.__VNCP_ENV[name];
  if (winVal !== undefined && winVal !== null) return String(winVal);

  // Build-time (Webpack/Vite define)
  // NOTE: your bundler must expose process.env.VARIABLES
  const proc = (typeof process !== "undefined" && process.env) ? process.env[name] : undefined;
  if (proc !== undefined && proc !== null) return String(proc);

  return String(fallback);
}

function parseBoolEnv(name, fallback = "true") {
  const v = readEnv(name, fallback).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
}

function parseIntEnv(name, fallback = "10") {
  const v = parseInt(readEnv(name, fallback), 10);
  return Number.isFinite(v) ? v : parseInt(fallback, 10);
}

// Auto-reload toggles (like your shell script style)
const RELOAD_IF_CHANGE_DETECT_ENABLE = parseBoolEnv("VERSANODE_WEB_CODE_RELOAD_IF_CHANGE_DETECT_ENABLE", "true");
const RELOAD_IF_CHANGE_DETECT_TIME_SECS   = parseIntEnv("VERSANODE_WEB_CODE_RELOAD_IF_CHANGE_DETECT_TIME_SECS", "10");
const RELOAD_IF_CHANGE_DETECT_TIME_MS     = Math.max(1000, RELOAD_IF_CHANGE_DETECT_TIME_SECS * 1000);

/* =========================
   Selectors (PF5 + PF6)
   ========================= */

// Integration tab <section> base (PF5 + PF6)
const integrationSectionPF5 =
  'section.pf-v5-c-tab-content[id^="pf-tab-section-"][id$="-create-image-dialog-tab-integration"]';
const integrationSectionPF6 =
  'section.pf-v6-c-tab-content[id^="pf-tab-section-"][id$="-create-image-dialog-tab-integration"]';

// Any PF grid we care about (PF5 or PF6), with gutter (limit scope to PF6 section per your note)
const anyGridWithGutter =
  `${integrationSectionPF6} .pf-m-gutter.pf-v5-l-grid, ${integrationSectionPF6} .pf-m-gutter.pf-v6-l-grid`;

// For styling grids (PF5 + PF6)
const integrationGridsSelector =
  `${integrationSectionPF5} .pf-v5-l-grid, ${integrationSectionPF6} .pf-v6-l-grid`;

// Optional: PF5 search modal body (compat)
const searchImageModalBody =
  'div[id^="pf-modal-part-"].vncp-image-search > div.pf-v5-c-modal-box__body';
const searchBodyPF6 = searchImageModalBody.replace("pf-v5", "pf-v6");

/* =========================
   Helpers: lower children 1 level + swap
   ========================= */

// Minimal class swapper (pf-v5-* → pf-v6-*)
function rewriteClassList(el, from, to, allowFn = null) {
  if (!el || !el.classList) return;
  const adds = [], removes = [];
  el.classList.forEach(cls => {
    if (!cls.startsWith(from)) return;
    if (allowFn && !allowFn(cls)) return;
    removes.push(cls);
    adds.push(to + cls.slice(from.length));
  });
  removes.forEach(c => el.classList.remove(c));
  adds.forEach(c => el.classList.add(c));
}

// Depth-first sweep (optionally exclude the anchor)
function sweep(root, from, to, allowFn, includeSelf = true) {
  if (!root) return;
  if (includeSelf) rewriteClassList(root, from, to, allowFn);
  for (const child of root.children || []) {
    rewriteClassList(child, from, to, allowFn);
    sweep(child, from, to, allowFn, true);
  }
}

// Wrap every direct child of a node (once)
function lowerChildrenOneLevel(node) {
  if (!node || node.nodeType !== 1) return;
  if (node.dataset?.vncpLowered === "1") return;
  const kids = Array.from(node.children);
  kids.forEach(child => {
    const wrapper = document.createElement("div");
    node.insertBefore(wrapper, child);
    wrapper.appendChild(child);
  });
  node.dataset.vncpLowered = "1";
}

// Force grid → PF6, lower children, then swap descendants pf-v5→pf-v6
function lowerAndSweepUnderGrid(gridEl, rule) {
  // Only change the grid class if it's a grid class
  rewriteClassList(gridEl, "pf-v5", "pf-v6", (cls) => cls.startsWith("pf-v5-l-grid"));
  lowerChildrenOneLevel(gridEl);
  // Convert everything under the grid (exclude the grid itself)
  sweep(gridEl, rule.from, rule.to, rule.allow, /*includeSelf*/ false);
}

/* =========================
   Swap rules
   ========================= */

// Convert below PF grid (limit to PF6 section scope)
const convertBelowGrid = {
  selector: anyGridWithGutter,
  from: "pf-v5",
  to: "pf-v6",
  includeSelf: false, // never touch the grid node in the sweep
  _apply(anchor) {
    lowerAndSweepUnderGrid(anchor, this);
  }
};

// Shallow flip for PF5 modal body (compat)
const shallowModalFlip = {
  selector: searchImageModalBody,
  from: "pf-v5",
  to: "pf-v6",
  levels: 1,
  includeSelf: true
};

// Use these rules
const swapRules = [convertBelowGrid, shallowModalFlip];

/* =========================
   Styles
   ========================= */

const styleRules = [
  // Search form container (PF6 body)
  {
    selector: `${searchBodyPF6} > form`,
    style: {
      width: "100%",
      display: "flex",
      flexWrap: "wrap",
      justifyContent: "flex-start",
      marginTop: "22px",
    },
  },
  // Turn the inner row into a 1/3–2/3 grid (PF5 + PF6)
  {
    selector: `${searchBodyPF6} > form .pf-v5-l-flex, ${searchBodyPF6} > form .pf-v6-l-flex`,
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 2fr",
      columnGap: "var(--pf-v6-global--spacer--md)",
      width: "100%",
      alignItems: "end",
    },
  },
  // Allow groups to shrink so inputs can fill their track
  {
    selector: `${searchImageModalBody} > form .pf-v5-c-form__group, ${searchBodyPF6} > form .pf-v6-c-form__group`,
    style: { minWidth: 0, flex: "initial" },
  },
  // Inputs/selects fill width (PF5 + PF6)
  {
    selector: `
      ${searchBodyPF6} > form .pf-v5-c-form-control input,
      ${searchBodyPF6} > form .pf-v5-c-form-control select,
      ${searchBodyPF6} > form .pf-v6-c-form-control input,
      ${searchBodyPF6} > form .pf-v6-c-form-control select
    `,
    style: { width: "100%", boxSizing: "border-box" },
  },
  // Margin above results list
  { selector: `${searchBodyPF6} > ul`, style: { marginTop: "22px" } },

  // Enforce a robust 12-col grid on PF grids (PF5 + PF6)
  {
    selector: integrationGridsSelector,
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
      gap: "var(--pf-v6-global--spacer--md, var(--pf-v5-global--spacer--md, 16px))",
      alignItems: "end",
    },
  },

  // Ensure field groups can shrink inside their cells (PF5 + PF6 bodies)
  {
    selector: `
      ${integrationSectionPF5} .pf-v5-c-form__field-group-body .pf-v5-c-form__group,
      ${integrationSectionPF6} .pf-v6-c-form__field-group-body .pf-v6-c-form__group
    `,
    style: { minWidth: 0 },
  },
];


/* =========================
   Route-change reloader (SPA)
   ========================= */

const FULL_RELOAD_IF_CHANGE_DETECT_ON_ROUTE_CHANGE = false; // true => hard reload

function patchHistory() {
  const fire = () => window.dispatchEvent(new Event("routechange"));
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function (...args) { const r = push.apply(this, args); fire(); return r; };
  history.replaceState = function (...args) { const r = replace.apply(this, args); fire(); return r; };
  window.addEventListener("popstate", fire);
  window.addEventListener("hashchange", fire);
}

/* =========================
   Auto page reload on code changes (Prod; optional Webpack HMR)
   ========================= */

// Helpers for hashing responses
function toHex(buf) {
  const v = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < v.length; i++) s += v[i].toString(16).padStart(2, "0");
  return s;
}

async function hashResponse(res) {
  const buf = await res.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return toHex(digest);
}

// Collect same-origin JS/CSS assets currently loaded
function collectSameOriginAssets() {
  const urls = new Set();

  // scripts
  document.querySelectorAll("script[src]").forEach((s) => {
    try {
      const u = new URL(s.src, location.href);
      if (u.origin === location.origin) urls.add(u.pathname + u.search);
    } catch {}
  });

  // stylesheets
  document.querySelectorAll('link[rel~="stylesheet"][href]').forEach((l) => {
    try {
      const u = new URL(l.href, location.href);
      if (u.origin === location.origin) urls.add(u.pathname + u.search);
    } catch {}
  });

  return Array.from(urls);
}

// Prod watcher: poll asset bytes (no-store), hash, and reload if any change
function startProdCodeWatcher({ intervalMs = 10000, extraVersionPaths = [] } = {}) {
  const assets = collectSameOriginAssets().concat(extraVersionPaths || []);
  if (!assets.length) return () => {};

  let live = true;
  let baseline = new Map();
  let ticking = false;

  const checkOnce = async () => {
    if (!live || ticking) return;
    ticking = true;

    try {
      if (baseline.size === 0) {
        const sigs = await Promise.all(
          assets.map(async (path) => {
            const res = await fetch(path, { cache: "no-store" });
            if (!res.ok) return [path, ""];
            return [path, await hashResponse(res)];
          })
        );
        sigs.forEach(([k, v]) => baseline.set(k, v));
        return;
      }

      for (const path of assets) {
        const res = await fetch(path, { cache: "no-store" });
        if (!res.ok) continue;
        const now = await hashResponse(res);
        const prev = baseline.get(path);
        if (prev && prev !== now) {
          location.reload();
          return;
        }
      }
    } catch {
      // ignore transient errors
    } finally {
      ticking = false;
    }
  };

  checkOnce();
  const t = setInterval(checkOnce, intervalMs);
  return () => { live = false; clearInterval(t); };
}

// Dev watcher for Webpack HMR only (no import.meta to avoid IIFE warnings)
function startDevHMRReload() {
  if (typeof module !== "undefined" && module && module.hot) {
    module.hot.accept(() => location.reload());
    module.hot.dispose(() => {});
    return () => {};
  }
  return () => {};
}

// Public entrypoint: enable auto reload on code changes (dev + prod)
function enableCodeChangeReload(options = {}) {
  const stopDev = startDevHMRReload();             // Webpack HMR (if present)
  const stopProd = startProdCodeWatcher(options);  // Hash-based watcher
  return () => { stopDev(); stopProd(); };
}

/* =========================
   Mount / Unmount
   ========================= */

let root = null;
let stopSwaps = null;
let mountKey = 0;

function mount() {
  const appEl = document.getElementById("app");
  if (!appEl) return;

  if (!root) root = createRoot(appEl);

  // Force full React remount on soft reloads
  root.render(<Application key={`route-${mountKey++}`} />);

  // Start swaps + live observer
  stopSwaps = enableSelectorSwaps({ swapRules, styleRules });

  // Clean up if app node disappears
  const unmountGuard = new MutationObserver(() => {
    if (!document.body.contains(appEl)) {
      stopSwaps?.();
      unmountGuard.disconnect();
    }
  });
  unmountGuard.observe(document.body, { childList: true, subtree: true });

  window.addEventListener(
    "beforeunload",
    () => {
      stopSwaps?.();
      unmountGuard.disconnect();
    },
    { once: true }
  );
}

function unmount() {
  try { stopSwaps?.(); } catch {}
  if (root) { root.unmount(); root = null; }
}

/* =========================
   Boot
   ========================= */

document.addEventListener("DOMContentLoaded", () => {
  patchHistory();
  mount();

  // Auto page reload when source files change (not DOM attribute changes)
  if (RELOAD_IF_CHANGE_DETECT_ENABLE) {
    const stopCodeReload = enableCodeChangeReload({
      intervalMs: RELOAD_IF_CHANGE_DETECT_TIME_MS,
      // Optional: publish a tiny build-id file and include it here:
      // extraVersionPaths: ["/app-version.txt"],
    });
    window.addEventListener("beforeunload", () => {
      stopCodeReload();
    });
    // Optional debug log
    try {
      console.log(
        `[VNCP] Code reload enabled: interval ${Math.round(RELOAD_IF_CHANGE_DETECT_TIME_MS / 1000)}s`
      );
    } catch {}
  } else {
    try { console.log("[VNCP] Code reload disabled by env"); } catch {}
  }

  window.addEventListener("routechange", () => {
    if (FULL_RELOAD_IF_CHANGE_DETECT_ON_ROUTE_CHANGE) {
      const prev = sessionStorage.getItem("__last_path__");
      const next = `${location.pathname}${location.search}${location.hash}`;
      if (prev !== next) {
        sessionStorage.setItem("__last_path__", next);
        location.reload();
      }
      return;
    }
    // Soft reload: remount React + restart swaps/styles
    unmount();
    queueMicrotask(mount);
  });
});
