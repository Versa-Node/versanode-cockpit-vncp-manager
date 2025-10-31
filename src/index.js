import "cockpit-dark-theme";
import React from 'react';
import { createRoot } from 'react-dom/client';
import 'patternfly/patternfly-5-cockpit.scss';
import Application from './app.jsx';
import './docker.scss';
import { enableSelectorSwaps } from './util.js';

// PF5 + PF6 modal bodies for the search modal
const searchImageModalBody = 'div[id^="pf-modal-part-"].vncp-image-search > div.pf-v5-c-modal-box__body' 
// PF5 + PF6 tab-content element for the Create Container “Integration” tab
const createContainerModalIntegrationTabBodyn =
  'section.pf-v5-c-tab-content[id^="pf-tab-section-"][id$="-create-image-dialog-tab-integration"] > div.pf-m-gutter pf-v5-l-grid';

const createContainerModalIntegrationTabBody = 'section.pf-v5-c-tab-content[id^="pf-tab-section-"][id$="-create-image-dialog-tab-integration"] > div > div.pf-v5-c-form__field-group-body';
//                                      ^ closing " ]                    ^ space for descendant combinator (likely)


// === Swap rules ===
const swapRules = [
  // Swap all PFv5 → PFv6 classes in the Integration tab subtree
  { selector: createContainerModalIntegrationTabBody, from: "pf-v5", to: "pf-v6", levels: -1, includeSelf: false },

  // Swap all PFv5 → PFv6 classes in the search modal body subtree
  { selector: searchImageModalBody, from: "pf-v5", to: "pf-v6", levels: 1, includeSelf: true },
];

// === Styles ===
const searchBodyPF6 = searchImageModalBody.replace("pf-v5", "pf-v6");

const styleRules = [
  // Search form container (no space-between; grid inside will manage widths)
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

  // Turn the inner flex row into a 1/3–2/3 grid
  {
    selector: `${searchBodyPF6} > form .pf-v5-l-flex, ${searchBodyPF6} > form .pf-v6-l-flex`,
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 2fr", // 1/3 : 2/3
      columnGap: "var(--pf-v6-global--spacer--md)",
      width: "100%",
      alignItems: "end",
    },
  },

  // Let groups shrink so inputs can actually fill their track
  {
    selector: `${searchImageModalBody} > form .pf-v5-c-form__group, ${searchBodyPF6} > form .pf-v6-c-form__group`,
    style: { minWidth: 0, flex: "initial" },
  },

  // Inputs/selects fill width
  {
    selector: `${searchBodyPF6} > form .pf-v5-c-form-control input, ${searchBodyPF6} > form .pf-v5-c-form-control select`,
    style: { width: "100%", boxSizing: "border-box" },
  },

  // Add margin above the search results list
  { selector: `${searchBodyPF6} > ul`, style: { marginTop: "22px" } },

  // --- Integration tab grid: ensure a robust 12-col grid after swaps ---
  // Make each PF grid behave like a 12-col CSS grid (safe even post-swap)
  {
    selector: `${createContainerModalIntegrationTabBody.replace("pf-v5", "pf-v6")} .pf-v6-l-grid, ${createContainerModalIntegrationTabBody} .pf-v5-l-grid`,
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
      gap: "var(--pf-v6-global--spacer--md)",
      alignItems: "end",
    },
  },

  // Ensure field groups can shrink within their grid cells
  {
    selector: `${createContainerModalIntegrationTabBody} .pf-v5-c-form__group, ${createContainerModalIntegrationTabBody.replace("pf-v5", "pf-v6")} .pf-v6-c-form__group`,
    style: { minWidth: 0 },
  },
];

// ---- Route-change reloader (route changes only; not code HMR) ----
const FULL_RELOAD_ON_ROUTE_CHANGE = false; // true => hard reload

function patchHistory() {
  const fire = () => window.dispatchEvent(new Event("routechange"));
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function (...args) {
    const r = push.apply(this, args);
    fire();
    return r;
  };
  history.replaceState = function (...args) {
    const r = replace.apply(this, args);
    fire();
    return r;
  };
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

  // Key forces a full React remount on soft reloads
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
  try {
    stopSwaps?.();
  } catch {}
  if (root) {
    root.unmount();
    root = null;
  }
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

  // (Optional) Dev HMR hook – uncomment if your bundler supports it
  // if (import.meta?.hot) {
  //   import.meta.hot.accept(() => { unmount(); mount(); });
  //   import.meta.hot.dispose(() => { unmount(); });
  // }
});