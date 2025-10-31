import "cockpit-dark-theme";
import React from "react";
import { createRoot } from "react-dom/client";
import "patternfly/patternfly-5-cockpit.scss";
import Application from "./app.jsx";
import "./docker.scss";
import { enableSelectorSwaps } from "./util.js";

// PF5 + PF6 modal bodies for the search modal
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

// === Swap rules ===
const swapRules = [
  // Swap all PFv5 → PFv6 classes in each field-group body subtree (keep parent as-is)
  { selector: integrationBodiesSelector, from: "pf-v5", to: "pf-v6", levels: -1, includeSelf: false },

  // Swap PFv5 → PFv6 inside the search modal body (one level deep)
  { selector: searchImageModalBody, from: "pf-v5", to: "pf-v6", levels: 1, includeSelf: true },
];

// === Styles ===
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

// ---- Route-change reloader (route changes only; not code HMR) ----
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

  window.addEventListener("beforeunload", () => {
    stopSwaps?.();
    unmountGuard.disconnect();
  }, { once: true });
}

function unmount() {
  try { stopSwaps?.(); } catch {}
  if (root) { root.unmount(); root = null; }
}

document.addEventListener("DOMContentLoaded", () => {
  patchHistory();
  mount();

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

  // // Optional: Dev HMR hook
  // if (import.meta?.hot) {
  //   import.meta.hot.accept(() => { unmount(); mount(); });
  //   import.meta.hot.dispose(() => { unmount(); });
  // }
});
