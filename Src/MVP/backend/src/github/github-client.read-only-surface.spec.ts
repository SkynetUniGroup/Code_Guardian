import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GithubClientService } from "./github-client.service";
import * as rotteDichiarate from "./github-routes";

/**
 * TU_14 (RS.3) — la superficie di GithubClientService è di sola lettura,
 * per ispezione della classe e non della whitelist a runtime.
 *
 * read-only-endpoint-whitelist.spec.ts verifica che la lista chiusa delle
 * rotte accetti le GET e rifiuti le scritture: è una garanzia sul
 * *contenuto* di quella lista. TU_14 chiede la garanzia complementare e
 * strutturale — che la classe non esponga proprio nulla che scriva — e per
 * definizione deve reggere anche se quella whitelist venisse svuotata,
 * riscritta o rimossa. Per questo qui non si importa né
 * READ_ONLY_ENDPOINT_WHITELIST né isReadOnlyEndpointAllowed: si guardano
 * soltanto i metodi della classe e le rotte che i loro corpi nominano.
 *
 * Due livelli, perché nessuno dei due basta da solo: il nome del metodo dice
 * l'intenzione (un `createPullRequest` sarebbe da bocciare a prescindere dal
 * corpo), il corpo dice il fatto (un metodo dal nome innocuo che emette una
 * POST è esattamente il caso che RS.3 deve escludere).
 */
describe("TU_14 (RS.3) — nessun metodo di GithubClientService scrive su GitHub", () => {
  const VERBI_DI_SCRITTURA = ["POST", "PUT", "PATCH", "DELETE"];

  // Prefissi verbali che denotano una modifica. Non è la lista dei verbi
  // ammessi — sarebbe un vincolo sul vocabolario, non su RS.3 — ma quella
  // dei verbi che una facade di sola lettura non può portare.
  const PREFISSI_DI_SCRITTURA = [
    "create",
    "update",
    "delete",
    "remove",
    "add",
    "insert",
    "post",
    "put",
    "patch",
    "write",
    "set",
    "save",
    "merge",
    "push",
    "upload",
    "send",
    "submit",
    "dispatch",
    "apply",
    "close",
    "reopen",
    "assign",
    "comment",
  ];

  const sorgente = readFileSync(resolve(__dirname, "github-client.service.ts"), "utf8");

  /**
   * I metodi dichiarati `private`. TypeScript cancella il modificatore in
   * compilazione — a runtime stanno sul prototipo come tutti gli altri —
   * quindi l'unico posto dove "pubblico" è ancora scritto è il sorgente.
   */
  const privati = new Set(
    [...sorgente.matchAll(/^\s*private\s+(?:async\s+)?(\w+)\s*[(<]/gm)].map((m) => m[1]),
  );

  /** Nome e corpo di ogni metodo effettivamente presente sul prototipo. */
  const metodi = Object.getOwnPropertyNames(GithubClientService.prototype)
    .filter((nome) => nome !== "constructor")
    .map((nome) => {
      const descrittore = Object.getOwnPropertyDescriptor(GithubClientService.prototype, nome);
      return { nome, valore: descrittore?.value as unknown };
    })
    .filter(({ valore }) => typeof valore === "function")
    .map(({ nome, valore }) => ({
      nome,
      pubblico: !privati.has(nome),
      corpo: (valore as () => unknown).toString(),
    }));

  const pubblici = metodi.filter((m) => m.pubblico);

  /**
   * Le rotte che il corpo di un metodo nomina, in entrambe le forme in cui
   * questa classe le scrive: la stringa letterale (`'GET /user/repos'`) e la
   * costante importata da github-routes (`GET_TREE_ROUTE`), che dopo la
   * compilazione compare come riferimento qualificato al modulo.
   */
  function rotteDi(corpo: string): string[] {
    const letterali = [...corpo.matchAll(/['"`]\s*([A-Z]+)\s+(\/[^'"`]*)['"`]/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    );

    const perCostante = [...corpo.matchAll(/\b([A-Z][A-Z0-9_]*_ROUTE)\b/g)]
      .map((m) => m[1])
      .map((nome) => {
        const valore = (rotteDichiarate as Record<string, string>)[nome];
        if (typeof valore !== "string") {
          throw new Error(
            `Il metodo usa la costante di rotta ${nome}, che github-routes.ts non esporta: ` +
              "TU_14 non è in grado di risolverla e non può dichiarare la classe di sola lettura.",
          );
        }
        return valore;
      });

    return [...letterali, ...perCostante];
  }

  /** I metodi che emettono davvero una richiesta verso GitHub. */
  const conRichiesta = metodi.filter(({ corpo }) => corpo.includes(".request("));

  it("l'ispezione trova davvero la superficie della classe", () => {
    // Senza questo, ogni asserzione qui sotto passerebbe anche su un elenco
    // vuoto — cioè il test resterebbe verde smettendo di verificare alcunché.
    expect(pubblici.length).toBeGreaterThan(0);
    expect(conRichiesta.length).toBeGreaterThan(0);
    expect(privati.size).toBeGreaterThan(0);
  });

  it("nessun metodo pubblico ha un nome che denoti una modifica", () => {
    const sospetti = pubblici
      .map(({ nome }) => nome)
      .filter((nome) => {
        const verbo = /^[a-z]+/.exec(nome)?.[0] ?? "";
        return PREFISSI_DI_SCRITTURA.includes(verbo);
      });
    expect(sospetti).toEqual([]);
  });

  it("ogni metodo che parla con GitHub nomina almeno una rotta risolvibile", () => {
    // Il presupposto dell'asserzione successiva: se un corpo emettesse una
    // richiesta senza che l'estrazione ne ricavi la rotta, "nessuna rotta di
    // scrittura" sarebbe vero per omissione.
    for (const { nome, corpo } of conRichiesta) {
      expect({ metodo: nome, rotte: rotteDi(corpo).length }).toEqual({
        metodo: nome,
        rotte: expect.any(Number),
      });
      expect(rotteDi(corpo).length).toBeGreaterThan(0);
    }
  });

  it("ogni rotta raggiunta da un metodo della classe è una GET", () => {
    const scritture = metodi.flatMap(({ nome, corpo }) =>
      rotteDi(corpo)
        .filter((rotta) => VERBI_DI_SCRITTURA.includes(rotta.split(" ")[0]))
        .map((rotta) => `${nome}: ${rotta}`),
    );
    expect(scritture).toEqual([]);

    const nonGet = metodi.flatMap(({ nome, corpo }) =>
      rotteDi(corpo)
        .filter((rotta) => !rotta.startsWith("GET "))
        .map((rotta) => `${nome}: ${rotta}`),
    );
    expect(nonGet).toEqual([]);
  });

  it("la classe non espone un passaggio generico su cui scegliere il verbo", () => {
    // Un metodo pubblico chiamato request/call/fetch/send sposterebbe la
    // scelta del verbo HTTP nel chiamante, e la garanzia strutturale
    // cadrebbe senza che nessuna delle asserzioni qui sopra se ne accorga.
    const passaggi = pubblici
      .map(({ nome }) => nome)
      .filter((nome) => ["request", "call", "fetch", "send", "query"].includes(nome));
    expect(passaggi).toEqual([]);
  });

  it("anche i metodi privati restano di sola lettura", () => {
    // RS.3 riguarda ciò che la classe fa, non solo ciò che dichiara: un
    // metodo privato che scrivesse sarebbe raggiungibile da ogni metodo
    // pubblico che lo chiama.
    const scritture = metodi
      .filter(({ pubblico }) => !pubblico)
      .flatMap(({ nome, corpo }) =>
        rotteDi(corpo)
          .filter((rotta) => !rotta.startsWith("GET "))
          .map((rotta) => `${nome}: ${rotta}`),
      );
    expect(scritture).toEqual([]);
  });
});
