// Centralizes all PatternFly class/selector swaps and style patches.
// Returns a stop() function to disconnect observers/cleanup.

import { enableSelectorSwaps } from "./util.js";

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
   Helpers
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
   Public API
   ========================= */

/**
 * Starts PatternFly alterations (PF5→PF6 class swaps and style patches)
 * and returns a stop() function to undo observers.
 */
export function enablePatternflyAlterations() {
  // Delegate to the existing util helper that wires MutationObservers and styles.
  return enableSelectorSwaps({ swapRules, styleRules });
}

// (Optional) named exports if you want granular control elsewhere
export const __vncpSwapRules = swapRules;
export const __vncpStyleRules = styleRules;
