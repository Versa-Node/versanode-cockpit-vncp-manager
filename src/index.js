import "cockpit-dark-theme";
import React from "react";
import { createRoot } from "react-dom/client";
import "patternfly/patternfly-5-cockpit.scss";
import Application from "./app.jsx";
import "./docker.scss";
import { enableSelectorSwaps } from "./util.js";

/* =========================
   Selectors (PF5 + PF6)
   ========================= */

// PF5 search modal body (we'll also derive the PF6 selector)
const searchImageModalBody =
  'div[id^="pf-modal-part-"].vncp-image-search > div.pf-v5-c-modal-box__body';

// Integration tab <section> (PF5 class on section in your DOM sample)
const integrationSection =
  'section.pf-v5-c-tab-content[id^="pf-tab-section-"][id$="-create-image-dialog-tab-integration"]';

// Each field-group body inside the Integration tab (PF5 + PF6)
const integrationBodiesSelector = [
  `${integrationSection} > div > div.pf-v5-c-form__field-group-body`,
  `${integrationSection.replace("pf-v5", "pf-v6")} > div > div.pf-v6-c-form__field-group-body`,
].join(", ");

// PF grid containers inside Integration tab (PF5 + PF6)
const integrationGridsSelector = [
  `${integrationSection} .pf-v5-l-grid`,
  `${integrationSection.replace("pf-v5", "pf-v6")} .pf-v6-l-grid`,
].join(", ");

/* =========================
   Swap rules
   ========================= */

const swapRules = [
  // Swap all PFv5 → PFv6 classes in each field-group body subtree (keep body node as-is)
  { selector: integrationBodiesSelector, from: "pf-v5", to: "pf-v6", levels: -1, includeSelf: false },

  // Swap PFv5 → PFv6 inside the search modal body (one level deep)
  { selector: searchImageModalBody, from: "pf-v5", to: "pf-v6", levels: 1, includeSelf: true },
];

/* =========================
   Styles
   ========================= */

const searchBodyPF6 = searchImageModalBody.replace("pf-v5", "pf-v6");

const styleRules = [
  // Search form container (let inner row manage widths)
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

  // Turn the inner row into a 1/3–2/3 grid
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

  // Inputs/selects fill width
  {
    selector: `${searchBodyPF6} > form .pf-v5-c-form-control input, ${searchBodyPF6} > form .pf-v5-c-form-control select`,
    style: { width: "100%", boxSizing: "border-box" },
  },

  // Margin above results list
  { selector: `${searchBodyPF6} > ul`, style: { marginTop: "22px" } },

  // Integration tab: enforce a robust 12-col grid on PF grids (PF5 + PF6)
  {
    selector: integrationGridsSelector,
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
      gap: "var(--pf-v6-global--spacer--md)",
      alignItems: "end",
    },
  },

  // Ensure field groups can shrink inside their cells
  {
    selector: `${integrationBodiesSelector} .pf-v5-c-form__group, ${integrationBodiesSelector.replace(/pf-v5/g, "pf-v6")} .pf-v6-c-form__group`,
    style: { minWidth: 0 },
  },
];

/* =========================
   Route-change reloader (SPA)
   ========================= */

const FULL_RELOAD_ON_ROUTE_CHANGE = false; // true => hard reload

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
   Auto page reload on code changes (Dev + Prod)
   ========================= */

// --- Helpers for hashing responses ---
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

// Dev watcher: hook HMR and force reload on module updates
function startDevHMRReload() {
  if (typeof import !== "undefined" && import.meta && import.meta.hot) {
    import.meta.hot.accept(() => location.reload());
    import.meta.hot.dispose(() => {});
    return () => {};
  }
  if (typeof module !== "undefined" && module.hot) {
    module.hot.accept(() => location.reload());
    module.hot.dispose(() => {});
    return () => {};
  }
  return () => {};
}

// Public entrypoint: enable auto reload on code changes (dev + prod)
function enableCodeChangeReload(options = {}) {
  const stopDev = startDevHMRReload();
  const stopProd = startProdCodeWatcher(options);
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
  const stopCodeReload = enableCodeChangeReload({
    intervalMs: 10000,
    // If you publish a tiny build-id file, include it here for ultra-cheap checks:
    // extraVersionPaths: ["/app-version.txt"],
  });

  window.addEventListener("beforeunload", () => {
    stopCodeReload();
  });

  window.addEventListener("routechange", () => {
    if (FULL_RELOAD_ON_ROUTE_CHANGE) {
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

  // // Optional: Dev HMR hook (already covered by enableCodeChangeReload, but kept for clarity)
  // if (import.meta?.hot) {
  //   import.meta.hot.accept(() => { unmount(); mount(); });
  //   import.meta.hot.dispose(() => { unmount(); });
  // }
});
