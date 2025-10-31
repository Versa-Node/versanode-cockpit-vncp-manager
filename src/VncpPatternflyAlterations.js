// Centralizes all PatternFly class/selector swaps and style patches.
// Returns a stop() function to disconnect observers/cleanup.

import { enableSelectorSwaps } from "./util.js";

/* =========================
   Debug helpers
   ========================= */

const DEBUG = (() => {
  try { return Boolean(window.__VNCP_DEBUG ?? true); } catch { return true; }
})();
function dlog(...args) { if (DEBUG) try { console.log("[VNCP]", ...args); } catch {} }
function dgroup(label, collapsed = true) {
  if (!DEBUG) return { end(){} };
  try {
    (collapsed ? console.groupCollapsed : console.group)(`[VNCP] ${label}`);
    return { end(){ try { console.groupEnd(); } catch {} } };
  } catch { return { end(){} }; }
}

/* =========================
   Selectors (PF5 + PF6)
   ========================= */

// Integration tab <section> base (PF5 + PF6) – still used by some style rules
const integrationSectionPF5 =
  'section.pf-v6-c-tab-content[id^="pf-tab-section-"][id$="-create-image-dialog-tab-integration"]';
const integrationSectionPF6 =
  'section.pf-v6-c-tab-content[id^="pf-tab-section-"][id$="-create-image-dialog-tab-integration"]';

// IMPORTANT: Global anchor for any PF grid with gutter (PF5/PF6) – order agnostic
const anyGridWithGutterGlobal = [
  ".pf-v6-l-grid.pf-m-gutter",
  ".pf-m-gutter.pf-v6-l-grid",
  ".pf-v6-l-grid.pf-m-gutter",
  ".pf-m-gutter.pf-v6-l-grid",
].join(", ");

// For styling grids (PF5 + PF6)
const integrationGridsSelector =
  `${integrationSectionPF5} .pf-v6-l-grid, ${integrationSectionPF6} .pf-v6-l-grid`;

// Optional: PF5 search modal body (compat)
const searchImageModalBody =
  'div[id^="pf-modal-part-"].vncp-image-search > div.pf-v6-c-modal-box__body';
const searchBodyPF6 = searchImageModalBody.replace("pf-v6", "pf-v6");

/* =========================
   Helpers
   ========================= */

// Minimal class swapper (pf-v6-* → pf-v6-*) with stats
function rewriteClassList(el, from, to, allowFn = null) {
  if (!el || !el.classList) return { removed: 0, added: 0 };
  const adds = [], removes = [];
  el.classList.forEach(cls => {
    if (!cls.startsWith(from)) return;
    if (allowFn && !allowFn(cls)) return;
    removes.push(cls);
    adds.push(to + cls.slice(from.length));
  });
  removes.forEach(c => el.classList.remove(c));
  adds.forEach(c => el.classList.add(c));
  return { removed: removes.length, added: adds.length };
}

// Depth-first sweep (optionally exclude the anchor). Returns total stats.
function sweep(root, from, to, allowFn, includeSelf = true) {
  if (!root) return { removed: 0, added: 0, nodes: 0 };
  let removed = 0, added = 0, nodes = 0;
  const apply = (node, inc = true) => {
    const s = rewriteClassList(node, from, to, allowFn);
    removed += s.removed; added += s.added; nodes += inc ? 1 : 0;
  };
  if (includeSelf) apply(root);
  for (const child of root.children || []) {
    apply(child);
    const s = sweep(child, from, to, allowFn, true);
    removed += s.removed; added += s.added; nodes += s.nodes;
  }
  return { removed, added, nodes };
}

// Wrap every direct child of a node (once), returning wrapper count
function lowerChildrenOneLevel(node) {
  if (!node || node.nodeType !== 1) return 0;
  if (node.dataset?.vncpLowered === "1") return 0;
  const kids = Array.from(node.children);
  kids.forEach(child => {
    const wrapper = document.createElement("div");
    node.insertBefore(wrapper, child);
    wrapper.appendChild(child);
  });
  node.dataset.vncpLowered = "1";
  return kids.length;
}

function lowerAndSweepUnderGrid(gridEl, rule) {
  const g = dgroup("PF grid anchor transform");
  try {
    if (!gridEl) return;

    // ✅ Do NOT rewrite the anchor grid class; leave pf-v6-l-grid / pf-m-gutter as-is
    dlog("Anchor grid left untouched:", gridEl, gridEl.className);

    // Lower direct children one level to stabilize PF6 layout descendants
    const wrapped = lowerChildrenOneLevel(gridEl);

    // Convert everything under the grid (exclude the grid itself)
    const deep = sweep(gridEl, rule.from, rule.to, rule.allow, /*includeSelf*/ false);

    dlog("Children wrapped:", wrapped);
    dlog("Descendant sweep:", deep);
  } finally {
    g.end();
  }
}


/* =========================
   Swap rules
   ========================= */

// Convert anything below ANY PF grid with gutter (global, order-agnostic)
const convertBelowGrid = {
  selector: anyGridWithGutterGlobal,
  from: "pf-v6",
  to: "pf-v6",
  includeSelf: false,            // ✅ never touch the anchor itself
  _apply(anchor) {
    const hasGutter = anchor.classList.contains("pf-m-gutter");
    const isPF5Grid = anchor.classList.contains("pf-v6-l-grid");
    const isPF6Grid = anchor.classList.contains("pf-v6-l-grid");
    if (!hasGutter || (!isPF5Grid && !isPF6Grid)) {
      dlog("Skipped anchor (not a PF grid with gutter):", anchor);
      return;
    }
    lowerAndSweepUnderGrid(anchor, this);
  }
};


// Shallow flip for PF5 modal body (compat)
const shallowModalFlip = {
  selector: searchImageModalBody,
  from: "pf-v6",
  to: "pf-v6",
  levels: 1,
  includeSelf: true,
  _apply(anchor) {
    const g = dgroup("Modal body shallow PF flip");
    try {
      // Only flip the immediate body & its first-level children
      const selfStats = rewriteClassList(anchor, this.from, this.to);
      let level1 = { removed: 0, added: 0, nodes: 0 };
      for (const child of Array.from(anchor.children || [])) {
        const s = rewriteClassList(child, this.from, this.to);
        level1.removed += s.removed; level1.added += s.added; level1.nodes++;
      }
      dlog("Anchor:", anchor);
      dlog("Self:", selfStats, "Level-1:", level1);
    } finally { g.end(); }
  }
};

// Use these rules
const swapRules = [convertBelowGrid, shallowModalFlip];

/* =========================
   Style patches
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
    selector: `${searchBodyPF6} > form .pf-v6-l-flex, ${searchBodyPF6} > form .pf-v6-l-flex`,
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
    selector: `${searchImageModalBody} > form .pf-v6-c-form__group, ${searchBodyPF6} > form .pf-v6-c-form__group`,
    style: { minWidth: 0, flex: "initial" },
  },
  // Inputs/selects fill width (PF5 + PF6)
  {
    selector: `
      ${searchBodyPF6} > form .pf-v6-c-form-control input,
      ${searchBodyPF6} > form .pf-v6-c-form-control select,
      ${searchBodyPF6} > form .pf-v6-c-form-control input,
      ${searchBodyPF6} > form .pf-v6-c-form-control select
    `,
    style: { width: "100%", boxSizing: "border-box" },
  },
  // Margin above results list
  { selector: `${searchBodyPF6} > ul`, style: { marginTop: "22px" } },

  // Enforce a robust 12-col grid on PF grids (PF5 + PF6) – only in the integration sections
  {
    selector: integrationGridsSelector,
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
      gap: "var(--pf-v6-global--spacer--md, var(--pf-v6-global--spacer--md, 16px))",
      alignItems: "end",
    },
  },

  // Ensure field groups can shrink inside their cells (PF5 + PF6 bodies)
  {
    selector: `
      ${integrationSectionPF5} .pf-v6-c-form__field-group-body .pf-v6-c-form__group,
      ${integrationSectionPF6} .pf-v6-c-form__field-group-body .pf-v6-c-form__group
    `,
    style: { minWidth: 0 },
  },
];

/* =========================
   Public API
   ========================= */

/**
 * Starts PatternFly alterations (PF5→PF6 class swaps and style patches)
 * and returns a stop() function to undo observers.
 *
 * Debugging:
 *   window.__VNCP_DEBUG = true  // enable (default)
 *   window.__VNCP_DEBUG = false // disable
 */
export function enablePatternflyAlterations() {
  dlog("PatternFly alterations starting…");
  const stop = enableSelectorSwaps({ swapRules, styleRules, debug: DEBUG });
  // Safety: also proactively process any currently present anchors once
  try {
    document.querySelectorAll(anyGridWithGutterGlobal).forEach((el) => convertBelowGrid._apply(el));
  } catch {}
  dlog("PatternFly alterations active.");
  return () => { dlog("PatternFly alterations stopping…"); try { stop?.(); } catch {} };
}

// Optional exports for inspection in devtools
export const __vncpSwapRules = swapRules;
export const __vncpStyleRules = styleRules;
export const __vncpHelpers = {
  rewriteClassList,
  sweep,        
    lowerChildrenOneLevel,
    lowerAndSweepUnderGrid, 
};
/* =========================
   End of File
   ========================= */

