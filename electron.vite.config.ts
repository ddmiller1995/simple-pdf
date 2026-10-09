import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * Dev-only: the Vite dev server injects an inline React Refresh preamble and talks to its HMR
 * websocket, which the strict production CSP forbids. Relax the CSP in `serve` mode only.
 */
function devCsp(): Plugin {
  return {
    name: 'simple-pdf:dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace(/script-src 'self'/, "script-src 'self' 'unsafe-inline'")
        .replace(/connect-src 'self'/, "connect-src 'self' ws://localhost:* http://localhost:*");
    },
  };
}

const alias = {
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared'),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    // Sandboxed preload scripts cannot require() node_modules: keep this one dependency-free.
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), devCsp()],
  },
});
