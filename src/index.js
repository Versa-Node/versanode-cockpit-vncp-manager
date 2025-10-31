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
  { selector: '#pf-modal-part-2 > form > div', from: 'pf-v6-', to: 'pf-v5-' },
  { selector: '#run-image-dialog-publish-0', from: 'pf-v5-', to: 'pf-v6-' },
  { selector: '#pf-tab-section-2-create-image-dialog-tab-integration > div.pf-v6-c-form__field-group.dynamic-form-group.volume-form', from: 'pf-v5-', to: 'pf-v6-' },
];

const styleRules = [
  // Add margin above the UL
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
