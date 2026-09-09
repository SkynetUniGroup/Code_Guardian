import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { servicesAvailable } from "./setup-e2e";

/**
 * Smoke test end-to-end sul percorso di autenticazione.
 *
 * Sostituisce lo scaffold generato da Nest, che era rimasto invariato e
 * verificava `GET /` → "Hello World!": una rotta che questa applicazione non
 * ha mai avuto, quindi un test che non poteva che fallire.
 *
 * Quello che qui si vuole davvero verificare è ciò che nessun test di unità
 * può cogliere: che l'intero grafo di dipendenze di AppModule si risolva
 * davvero (è il punto in cui il progetto si rompeva: tipi importati come
 * type-only azzerano i metadata della DI), che il ValidationPipe globale sia
 * effettivamente attivo sui DTO, e che il prefisso /api/v1 e il filtro delle
 * eccezioni si comportino come si aspettano frontend e agenti.
 */
const available = await servicesAvailable();

describe.skipIf(!available)("Auth (e2e)", () => {
  let app: INestApplication;
  const email = `e2e-${Date.now()}@example.com`;
  const password = "password123";
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    // Stessa configurazione di main.ts: un e2e che non la replica verifica
    // un'applicazione che non è quella che va in produzione.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("espone l'health check senza autenticazione, sotto il prefisso /api/v1", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/auth/health").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("registra un utente e restituisce il profilo senza la password", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ firstName: "Ada", lastName: "Lovelace", email, password, role: "DEVELOPER" })
      .expect(201);

    expect(res.body).toMatchObject({ email, role: "DEVELOPER", firstName: "Ada" });
    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("passwordHash");
  });

  it("rifiuta una registrazione non valida con 400 VALIDATION_ERROR", async () => {
    // Verifica che il ValidationPipe globale stia davvero girando sui DTO:
    // con i DTO importati come type-only il metatype andava perso e ogni corpo
    // passava senza controlli.
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        firstName: "",
        lastName: "X",
        email: "non-una-email",
        password: "corta",
        role: "ALIENO",
      })
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("rifiuta un campo non previsto dal DTO (forbidNonWhitelisted)", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password, ruolo: "ADMIN" })
      .expect(400);
  });

  it("effettua il login e restituisce un access token", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password })
      .expect(200);

    expect(typeof res.body.accessToken).toBe("string");
    accessToken = res.body.accessToken;
  });

  it("rifiuta credenziali sbagliate con 401", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "password999" })
      .expect(401);
  });

  it("restituisce il profilo su GET /auth/me con il token", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(email);
  });

  it("rifiuta GET /auth/me senza token con 401", async () => {
    await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);
  });

  it("elenca le operazioni consentite al ruolo dell'utente", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/operations")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const codes = res.body.map((o: { code: string }) => o.code);
    // DEVELOPER: documentazione + changelog tecnico, mai le operazioni di sicurezza.
    expect(codes).toContain("DOCS_README");
    expect(codes).not.toContain("SECURITY_OWASP");
    expect(res.body[0]).toHaveProperty("displayName");
    expect(res.body[0]).toHaveProperty("description");
  });

  it("respinge le rotte interne senza firma HMAC", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/internal/github/tree")
      .send({ taskId: "68b0f0c0c0c0c0c0c0c0c0c0" })
      .expect(401);
  });
});
