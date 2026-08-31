import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Config dedicata ai test (separata da vite.config.ts, che resta quella di
// build/dev reale) cosi' da non introdurre dipendenze di test nel bundle
// prodotto per l'utente finale.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Gli E2E Playwright vivono in ./e2e e hanno un proprio runner/config
    // (playwright.config.ts): esclusi qui perche' Vitest, di default,
    // raccoglierebbe anche i loro *.spec.ts insieme ai test di unita'.
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/App.tsx',
        'src/router.tsx',
        'src/routeTree.gen.ts',
        'src/routes/**',
        'src/types/**',
        'src/vite-env.d.ts',
        'src/test/**',
      ],
    },
  },
});
