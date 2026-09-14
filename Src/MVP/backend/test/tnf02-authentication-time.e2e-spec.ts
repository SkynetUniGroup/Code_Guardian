import request from "supertest";
import { E2EEnvironment, startEnvironment } from "./e2e-helpers";

/**
 * TNF_02 (RQ.9) — the authentication process stays under two seconds.
 *
 * Measured "end-to-end on POST /auth/login", as the requirement says: the
 * request starts from supertest and the stopwatch stops when the response
 * is complete, so it includes reading the user from MongoDB, Argon2id
 * verification and JWT issuance. The application is the real one, built by
 * the shared scaffolding: measuring an isolated service would give a lower
 * number with no relation to what the user expects.
 *
 * Why multiple measurements and not one. Argon2id with the parameters of
 * `password.service.ts` (memoryCost 65536, timeCost 3, parallelism 4) costs
 * a few tens of milliseconds, against a limit of 2000: the margin is huge,
 * so a single lucky measurement would say nothing and a single unlucky one
 * — the garbage collector, the first access to an index, a busy machine —
 * would make the test intermittent without anything actually getting
 * worse. It is measured multiple times and judged on the median and the
 * maximum: the median says how it usually goes, the maximum is the strict
 * reading of the requirement, which speaks of a cap and not an average.
 *
 * The first measurement is deliberately discarded: the first login of a
 * process pays for JIT compilation of the path and opening the connection
 * pool, costs the real user does not see because the server is already
 * warm when they arrive.
 */
describe("TNF_02 (RQ.9) — authentication process time", () => {
  let env: E2EEnvironment;

  /** Limit declared by RQ.9, in milliseconds. */
  const LIMIT_MS = 2_000;

  /** Measurements evaluated, beyond the discarded warmup one. */
  const REPETITIONS = 10;

  const PASSWORD = "test-password-123";
  let email: string;

  function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** Executes a login and returns how long it took, in milliseconds. */
  async function timeLogin(passwordUsed = PASSWORD, expectedStatus = 200): Promise<number> {
    const start = Date.now();
    await request(env.server)
      .post("/api/v1/auth/login")
      .send({ email, password: passwordUsed })
      .expect(expectedStatus);
    return Date.now() - start;
  }

  /** Repeats the measurement, discarding the first. */
  async function sample(passwordUsed = PASSWORD, expectedStatus = 200): Promise<number[]> {
    await timeLogin(passwordUsed, expectedStatus);
    const measurements: number[] = [];
    for (let i = 0; i < REPETITIONS; i += 1) {
      measurements.push(await timeLogin(passwordUsed, expectedStatus));
    }
    return measurements;
  }

  /** Prints the sample, because the measured number is the test result. */
  function report(label: string, measurements: number[]): void {
    const sorted = [...measurements].sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(
      `TNF_02 ${label}: median ${median(measurements)} ms, ` +
        `min ${sorted[0]} ms, max ${sorted[sorted.length - 1]} ms ` +
        `(${measurements.length} measurements, limit ${LIMIT_MS} ms) — [${sorted.join(", ")}]`,
    );
  }

  beforeAll(async () => {
    env = await startEnvironment();

    email = `tnf02-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
    await request(env.server)
      .post("/api/v1/auth/register")
      .send({
        firstName: "Ada",
        lastName: "Lovelace",
        email,
        password: PASSWORD,
        role: "DEVELOPER",
      })
      .expect(201);
  }, 60_000);

  afterAll(async () => {
    await env?.close();
  });

  it("a successful login stays within two seconds, on median and maximum", async () => {
    const measurements = await sample();
    report("successful login", measurements);

    expect(median(measurements)).toBeLessThanOrEqual(LIMIT_MS);
    expect(Math.max(...measurements)).toBeLessThanOrEqual(LIMIT_MS);
  }, 120_000);

  it("even the attempt with a wrong password stays within budget", async () => {
    // The rejection path is not cheaper: `login` still verifies the hash —
    // against a DUMMY_HASH when the user does not exist — to avoid leaking
    // which emails are registered through timing. It is therefore a case
    // that RQ.9 must hold as much as the successful one, and it is also the
    // most frequent under a brute force attack, i.e. when the limit matters.
    const measurements = await sample("wrong-password-123", 401);
    report("rejected login", measurements);

    expect(median(measurements)).toBeLessThanOrEqual(LIMIT_MS);
    expect(Math.max(...measurements)).toBeLessThanOrEqual(LIMIT_MS);
  }, 120_000);

  it("the measured time truly includes password verification", async () => {
    // Without this check the test would stay green even if someone
    // disabled Argon2id: a login that verifies nothing is very fast, and
    // "under two seconds" would be true in the worst possible way. The
    // reference point is an endpoint of the same server that does no
    // cryptographic work: the login must cost visibly more.
    //
    // The threshold is an absolute difference and not a ratio: the reference
    // measures 1 or 2 milliseconds and on a ratio its variation would weigh
    // as much as that of the login. Ten milliseconds are well below the
    // real cost of Argon2id with the current parameters (a few tens) and
    // well above the cost of a request that computes nothing, so they
    // distinguish the two situations without being sensitive to noise.
    const reference: number[] = [];
    for (let i = 0; i < REPETITIONS; i += 1) {
      const start = Date.now();
      await request(env.server).get("/api/v1/auth/health").expect(200);
      reference.push(Date.now() - start);
    }
    const login = await sample();

    report("login", login);
    report("GET /auth/health (reference)", reference);

    expect(median(login) - median(reference)).toBeGreaterThanOrEqual(10);
  }, 120_000);
});
