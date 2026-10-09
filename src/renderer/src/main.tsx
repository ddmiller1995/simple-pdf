import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { markTextReady } from './overlays/textReady';
import { FONT_FAMILY, FONT_URL } from './pdf/fontSource';
import { initTextLayout } from './pdf/textLayout';
import './styles.css';

/** Load the bundled text font for the screen TextBox (same file the export embeds, plan D9). */
async function prepareText(): Promise<void> {
  const style = document.createElement('style');
  style.textContent = `@font-face { font-family: "${FONT_FAMILY}"; src: url("${FONT_URL}") format("truetype"); font-display: block; }`;
  document.head.appendChild(style);
  try {
    await Promise.all([initTextLayout(), document.fonts.load(`12px "${FONT_FAMILY}"`)]);
    markTextReady();
  } catch (err) {
    console.error('Could not load the text font', err);
  }
}

// Mount at once; text overlays appear as soon as the font is ready (overlays/textReady.ts).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
void prepareText();

// Test-only hook: loaded solely when an E2E init script sets this flag (the app never does).
if ((window as { __SIMPLE_PDF_E2E__?: boolean }).__SIMPLE_PDF_E2E__) {
  void import('./testHook');
}
