import "cockpit-dark-theme";
import React from "react";
import { createRoot } from "react-dom/client";
import "patternfly/patternfly-5-cockpit.scss";
import Application from "./app.jsx";
import "./docker.scss";
import { enablePatternflyAlterations } from "./VncpPatternflyAlterations.js";

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
let stopAlterations = null;
let mountKey = 0;

function mount() {
  const appEl = document.getElementById("app");
  if (!appEl) return;

  if (!root) root = createRoot(appEl);

  // Force full React remount on soft reloads
  root.render(<Application key={`route-${mountKey++}`} />);

  // PatternFly class/selector alterations + live observer
  stopAlterations = enablePatternflyAlterations();

  // Clean up if app node disappears
  const unmountGuard = new MutationObserver(() => {
    if (!document.body.contains(appEl)) {
      try { stopAlterations?.(); } catch {}
      unmountGuard.disconnect();
    }
  });
  unmountGuard.observe(document.body, { childList: true, subtree: true });

  window.addEventListener(
    "beforeunload",
    () => {
      try { stopAlterations?.(); } catch {}
      unmountGuard.disconnect();
    },
    { once: true }
  );
}

function unmount() {
  try { stopAlterations?.(); } catch {}
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
    // Soft reload: remount React + restart alterations
    unmount();
    queueMicrotask(mount);
  });
});
