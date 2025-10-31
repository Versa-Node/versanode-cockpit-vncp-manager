import "cockpit-dark-theme";
import React from 'react';
import { createRoot } from 'react-dom/client';
import 'patternfly/patternfly-5-cockpit.scss';
import Application from './app.jsx';
import './docker.scss';
import { enableSelectorSwaps } from './util.js';

// PF5 + PF6 modal bodies for the search modal
const searchImageModalBody1 = 'div[id^="pf-modal-part-"].vncp-image-search > div.pf-v5-c-modal-box__body' 
const searchImageModalBody2 = searchImageModalBody1 + ', ' + searchImageModalBody1.replace('pf-v5', 'pf-v6');

// PF5 + PF6 tab-content element for the Create Container “Integration” tab
const createContainerModalIntegrationTabBody1 = 'section[id^="pf-tab-section-"][id$="-create-image-dialog-tab-integration"].pf-v5-c-tab-content > div.pf-v5-c-form__field-group-body > div[id^="run-image-dialog-publish-"]' 
const createContainerModalIntegrationTabBody2 = createContainerModalIntegrationTabBody1 + ', ' + createContainerModalIntegrationTabBody1.replace('pf-v5', 'pf-v6');

const swapRules = [
  // Swap all PFv5 → PFv6 classes in the Integration tab subtree
  { selector: createContainerModalIntegrationTabBody2, from: 'pf-v5', to: 'pf-v6', levels: -1, includeSelf: false },
  // Swap all PFv5 → PFv6 classes in the search modal body subtree
  { selector: searchImageModalBody2, from: 'pf-v5', to: 'pf-v6', levels: 1 },
];

const styleRules = [
  // Make the form stretch and wrap nicely
  {
    selector: `${searchImageModalBody2} > form`,
    style: {
      width: '100%',
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginTop: '22px',
    },
  },
  // Make each form group take half width (ish) on wide viewports
  {
    selector: `${searchImageModalBody2} > form .pf-v5-c-form__group, ${searchImageModalBody2} > form .pf-v6-c-form__group`,
    style: {
      flex: '1 1 48%',
      minWidth: '300px',
    },
  },
  // Ensure the inputs/selects inside the scoped form span 100% width
  {
    selector: `${searchImageModalBody2} > form.pf-v6-c-form .pf-v5-c-form-control input, ${searchImageModalBody2} > form.pf-v6-c-form .pf-v5-c-form-control select, ${searchImageModalBody2} > form.pf-v5-c-form .pf-v5-c-form-control input, ${searchImageModalBody2} > form.pf-v5-c-form .pf-v5-c-form-control select`,
    style: {
      width: '100%',
      boxSizing: 'border-box',
    },
  },
  // Optional: if PF flex row is inline and cramping space, make it full width & wrap
  {
    selector: `${searchImageModalBody2} > form .pf-v5-l-flex, ${searchImageModalBody2} > form .pf-v6-l-flex`,
    style: { width: '100%', flexWrap: 'wrap', gap: 'var(--pf-v6-global--spacer--md)' },
  },
  // Add margin above the result list
  { selector: `${searchImageModalBody2} > ul`, style: { marginTop: '22px' } },
];

document.addEventListener("DOMContentLoaded", () => {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  const root = createRoot(appEl);
  root.render(<Application />);

  // Start swaps (scoped + live via MutationObserver)
  const stopSwaps = enableSelectorSwaps({ swapRules, styleRules });

  // Stop swaps when app unmounts or page navigates
  const observer = new MutationObserver(() => {
    if (!document.body.contains(appEl)) {
      stopSwaps();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('beforeunload', () => {
    stopSwaps();
    observer.disconnect();
  });
});
