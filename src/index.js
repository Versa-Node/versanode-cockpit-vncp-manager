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
const createContainerModalIntegrationTabBody = 'section[id^="pf-tab-section-"][id$="-create-image-dialog-tab-integration] > div > div.pf-v5-c-form__field-group-body'

const swapRules = [
  // Swap all PFv5 → PFv6 classes in the Integration tab subtree
  { selector: createContainerModalIntegrationTabBody, from: 'pf-v5', to: 'pf-v6', levels: -1, includeSelf: true },
  // Swap all PFv5 → PFv6 classes in the search modal body subtree
  { selector: searchImageModalBody, from: 'pf-v5', to: 'pf-v6', levels: 1, includeSelf: true  },
];

const styleRules = [
  // Form container: don't space-between; let the inner row handle layout
  {
    selector: `${searchImageModalBody.replace('pf-v5', 'pf-v6')} > form`,
    style: {
      width: '100%',
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',     // was 'space-between'
      marginTop: '22px',
    },
  },

  // Turn the flex row into a 2-col grid (1/3, 2/3)
  {
    selector: `${searchImageModalBody.replace('pf-v5', 'pf-v6')} > form .pf-v5-l-flex, ${searchImageModalBody.replace('pf-v5', 'pf-v6')} > form .pf-v6-l-flex`,
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 2fr',   // 1/3 and 2/3
      columnGap: 'var(--pf-v6-global--spacer--md)',
      width: '100%',
      alignItems: 'end',                // nice label/input alignment
    },
  },

  // Let groups shrink inside the grid cells (important for long labels)
  {
    selector: `${searchImageModalBody} > form .pf-v5-c-form__group, ${searchImageModalBody.replace('pf-v5','pf-v6')} > form .pf-v6-c-form__group`,
    style: {
      minWidth: 0,   // prevents overflow; allows inputs to actually fill
      flex: 'initial' // neutralize previous flex: 1 1 48%
    },
  },

  // Inputs/selects should fill their cell (you already have this; keep it)
  {
    selector: `${searchImageModalBody.replace('pf-v5','pf-v6')} > form .pf-v5-c-form-control input, ${searchImageModalBody.replace('pf-v5','pf-v6')} > form .pf-v5-c-form-control select`,
    style: { width: '100%', boxSizing: 'border-box' },
  },
];

// ---- Route-change reloader ----
const FULL_RELOAD_ON_ROUTE_CHANGE = false; // <- set to true for hard reloads

function patchHistory() {
  const fire = () => window.dispatchEvent(new Event('routechange'));
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function (...args) { const r = push.apply(this, args); fire(); return r; };
  history.replaceState = function (...args) { const r = replace.apply(this, args); fire(); return r; };
  window.addEventListener('popstate', fire);
  window.addEventListener('hashchange', fire);
}

let root = null;
let stopSwaps = null;
let mountKey = 0;

function mount() {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  // (Re)create the root if needed
  if (!root) root = createRoot(appEl);

  // Use a changing key to force React to fully remount the tree (soft reload)
  root.render(<Application key={`route-${mountKey++}`} />);

  // Start swaps (scoped + live via MutationObserver)
  stopSwaps = enableSelectorSwaps({ swapRules, styleRules });

  // Stop swaps when app unmounts or page navigates away entirely
  const unmountGuard = new MutationObserver(() => {
    if (!document.body.contains(appEl)) {
      stopSwaps?.();
      unmountGuard.disconnect();
    }
  });
  unmountGuard.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('beforeunload', () => {
    stopSwaps?.();
    unmountGuard.disconnect();
  }, { once: true });
}

function unmount() {
  try { stopSwaps?.(); } catch {}
  if (root) { root.unmount(); root = null; }
}

document.addEventListener('DOMContentLoaded', () => {
  patchHistory();
  mount();

  window.addEventListener('routechange', () => {
    if (FULL_RELOAD_ON_ROUTE_CHANGE) {
      // Hard reload the whole document on any SPA route change
      // (guard against loops by only reloading when path actually changed)
      const prev = sessionStorage.getItem('__last_path__');
      const next = `${location.pathname}${location.search}${location.hash}`;
      if (prev !== next) {
        sessionStorage.setItem('__last_path__', next);
        location.reload();
      }
      return;
    }

    // Soft reload: cleanly remount React and restart swaps/styles
    unmount();
    // Delay a tick so any new DOM from the router has landed
    queueMicrotask(mount);
  });
});