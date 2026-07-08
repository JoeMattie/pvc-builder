import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// self-hosted IBM Plex (no network at runtime)
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/500.css';
import './index.css';
import { useThemeStore } from './state/themeStore';
import { App } from './ui/App';
import { applyTheme } from './ui/theme';

// apply the persisted day/night choice before first paint, then follow the store
applyTheme(useThemeStore.getState().night ? 'night' : 'day');
useThemeStore.subscribe((s) => applyTheme(s.night ? 'night' : 'day'));

const container = document.getElementById('root');
if (!container) throw new Error('missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
