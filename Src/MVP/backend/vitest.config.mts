import { defineConfig } from "vitest/config";

// Configurazione esplicita per i test di unità del backend.
//
// Prima non esisteva: `vitest run` dentro backend/ girava sui default,
// appoggiandosi di fatto a quello che trovava risalendo l'albero — comportamento
// non dichiarato da nessuna parte e che cambia con la versione di Vitest.
// Soprattutto, il config alla radice del monorepo raccoglieva *anche* i test del
// frontend e li eseguiva in ambiente "node", dove `document` non esiste.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Vedi il file: espone `jest` come alias di `vi`, perche' gli helper di
    // test di @nestjs-modules/ioredis sono scritti per Jest.
    setupFiles: ["./test/setup-unit.ts"],
    include: ["src/**/*.spec.ts"],
    // Gli e2e hanno il proprio config (test/vitest-e2e.config.mts) e hanno
    // bisogno di MongoDB e Redis in esecuzione: non vanno raccolti qui.
    exclude: ["node_modules/**", "dist/**", "test/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/main.ts", "src/**/schemas/**", "src/**/dto/**"],
      // Soglie del Piano di Qualifica, non valori scelti qui: MP_12 fissa la
      // copertura di linea accettabile al 75%, MPD_8 la copertura di ramo al
      // 60%. Senza `thresholds` la copertura veniva misurata e stampata ma
      // non vincolava nulla, cioe' una regressione sotto la soglia del PdQ
      // sarebbe passata in CI senza che nessuno se ne accorgesse — l'unico
      // punto del progetto dove la metrica era gia' applicata erano gli
      // agenti Python (`--cov-fail-under=75` in pytest.ini).
      //
      // Il valore e' quello *accettabile*, non quello ottimale (90%/85%):
      // una soglia va messa dove deve suonare l'allarme, non dove si spera
      // di arrivare.
      thresholds: {
        lines: 75,
        branches: 60,
      },
    },
  },
});
