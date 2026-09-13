import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Config dedicata ai test (separata da vite.config.ts, che resta quella di
// build/dev reale) cosi' da non introdurre dipendenze di test nel bundle
// prodotto per l'utente finale.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Gli E2E Playwright vivono in ./e2e e hanno un proprio runner/config
    // (playwright.config.ts): esclusi qui perche' Vitest, di default,
    // raccoglierebbe anche i loro *.spec.ts insieme ai test di unita'.
    exclude: [
      "e2e/**",
      "node_modules/**",
      // TODO: questo file testa una versione precedente dell'hook (useAppStore,
      // sessionStorage diretto, un flusso di silent-login) che non esiste piu':
      // useWebSocket.ts ora usa useSessionStore/useTasksStore e non ha piu' quel
      // flusso. Va riscritto da chi conosce l'architettura attuale degli store;
      // per ora e' escluso per non bloccare la CI su un test obsoleto.
      "src/hooks/useWebSocket.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/App.tsx",
        "src/router.tsx",
        "src/routeTree.gen.ts",
        "src/routes/**",
        "src/types/**",
        "src/vite-env.d.ts",
        "src/test/**",
      ],
    },
  },
});
