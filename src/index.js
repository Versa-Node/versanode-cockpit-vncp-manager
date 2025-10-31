import "cockpit-dark-theme";
import React from 'react';
import { createRoot } from 'react-dom/client';
import 'patternfly/patternfly-5-cockpit.scss';
import Application from './app.jsx';
import './docker.scss';
import { enableScopedPfV5toV6Swap } from './util.js';

document.addEventListener("DOMContentLoaded", () => {
  const appEl = document.getElementById('app');

  // Render first, then rewrite classes (and keep watching new children)
  const root = createRoot(appEl);
  root.render(<Application />);

  // Swap ONLY inside this app’s root (and all its descendants)
  // Denylist keeps special classes like pf-v5-svg intact.
  const stopSwap = enableScopedPfV5toV6Swap(appEl, {
    denylist: new Set(['pf-v5-svg']),
    live: true, // keep observing React updates
  });

  // If you ever need to stop it:
  // window.__stopPfSwap = stopSwap;
});
