import "cockpit-dark-theme";
import React from 'react';
import { createRoot } from 'react-dom/client';
import 'patternfly/patternfly-5-cockpit.scss';
import Application from './app.jsx';
import './docker.scss';
import { enableSelectorSwaps } from './util.js';

// UI replacements here
const swapRules = [
  // Swap class
  { selector: '#run-image-dialog-volume-0', from: 'pf-v5', to: 'pf-v6', levels: -1},
  
  { selector: '#run-image-dialog-publish-0', from: 'pf-v5', to: 'pf-v6', levels: -1 },
  { selector: '#pf-modal-part-2', from: 'pf-v5', to: 'pf-v6' , levels: 1 },
];

const styleRules = [
 { selector: '#pf-modal-part-2 > ul', style: { marginTop: '22px' } },
];

document.addEventListener("DOMContentLoaded", () => {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  // Mount the app
  const root = createRoot(appEl);
  root.render(<Application />);

  // Start PF swaps
  const stopSwaps = enableSelectorSwaps({ swapRules, styleRules });

  // --- Stop swaps automatically when app is no longer active ---
  const observer = new MutationObserver(() => {
    const stillPresent = document.body.contains(appEl);
    if (!stillPresent) {
      console.log('[PF Swap] App removed — stopping swaps.');
      stopSwaps();
      observer.disconnect();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also stop if page unloads (e.g., cockpit navigates away)
  window.addEventListener('beforeunload', () => {
    stopSwaps();
    observer.disconnect();
  });
});
