import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.e2e-spec.ts"],
    // Il setup punta l'app ai servizi di docker-compose.test.yml e permette ai
    // test di auto-skipparsi se non sono su.
    setupFiles: ["./test/setup-e2e.ts"],
    // Un solo worker: i test condividono lo stesso database e lo stesso utente.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});