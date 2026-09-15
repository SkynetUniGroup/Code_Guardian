import { PasswordService } from "./password.service";

describe("PasswordService", () => {
  const service = new PasswordService();

  it("round-trips: verifying a hash against its original plaintext succeeds", async () => {
    const hash = await service.hash("Sup3rSecret");
    await expect(service.verify(hash, "Sup3rSecret")).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await service.hash("Sup3rSecret");
    await expect(service.verify(hash, "wrong-password")).resolves.toBe(false);
  });

  it("hashes the same password differently each time", async () => {
    const a = await service.hash("Sup3rSecret");
    const b = await service.hash("Sup3rSecret");
    expect(a).not.toBe(b);
  });

  /**
   * TU_12 (RS.1) — la metà del requisito che i tre test qui sopra non dicono.
   *
   * Loro verificano che la verifica funzioni; questo verifica che il digest
   * non contenga la password. Sono proprietà indipendenti: una funzione che
   * restituisse `"plain:" + password` supererebbe tutti e tre i test
   * precedenti — round-trip, password sbagliata, sale diverso — e sarebbe
   * comunque una fuga di credenziali in chiaro dentro il database.
   */
  it("il digest non contiene la password in chiaro, in nessuna codifica ovvia", async () => {
    const password = "Sup3rSecret";
    const hash = await service.hash(password);

    expect(hash).not.toContain(password);
    expect(hash.toLowerCase()).not.toContain(password.toLowerCase());
    expect(hash).not.toContain(Buffer.from(password, "utf8").toString("base64"));
    expect(hash).not.toContain(Buffer.from(password, "utf8").toString("hex"));
  });

  it("il digest dichiara Argon2id, non una variante più debole", async () => {
    // RS.1 nomina Argon2id. Argon2i e Argon2d esistono e producono un digest
    // della stessa forma: senza questo controllo, passare alla variante
    // sbagliata non farebbe fallire nessun test.
    const hash = await service.hash("Sup3rSecret");

    expect(hash.startsWith("$argon2id$")).toBe(true);
  });
});
