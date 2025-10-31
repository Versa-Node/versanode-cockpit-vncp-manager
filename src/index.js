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

   // Scope to your app root; modals are auto-handled via the body observer.
  enableScopedPfV5toV6Swap([document.getElementById('app')]);
});
