import { createConnection } from "node:net";

/**
 * Setup della suite e2e.
 *
 * Due compiti:
 *  1. puntare la configurazione dell'app ai servizi di docker-compose.test.yml
 *     (porte dedicate, database usa-e-getta), prima che AppModule legga l'env;
 *  2. dire chiaramente se quei servizi non ci sono, invece di far esplodere la
 *     suite con un timeout di Mongoose che non spiega nulla.
 *
 * Il file era referenziato da vitest-e2e.config.mts ma non esisteva: la suite
 * e2e non era mai partita.
 */

const MONGO_HOST = "127.0.0.1";
const MONGO_PORT = 27018;
const REDIS_PORT = 6380;

process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT ?? "3001";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.MONGODB_URI = `mongodb://${MONGO_HOST}:${MONGO_PORT}/codeguardian-e2e`;
process.env.REDIS_URL = `redis://${MONGO_HOST}:${REDIS_PORT}`;
// Segreti fittizi ma di lunghezza valida: il Joi in env.validation.ts ne
// pretende almeno 16 caratteri, e senza l'app non fa nemmeno il bootstrap.
process.env.JWT_SECRET = "e2e-jwt-secret-0123456789abcdef";
process.env.CREDENTIAL_MASTER_KEY = "e2e-credential-master-key-0123456789";
process.env.INTERNAL_SHARED_SECRET = "e2e-internal-shared-secret-0123456789";
process.env.S3_ACCESS_KEY_ID = "minioadmin";
process.env.S3_SECRET_ACCESS_KEY = "minioadmin";
process.env.S3_ENDPOINT = `http://${MONGO_HOST}:9002`;
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.REPORTS_BUCKET_NAME = "code-guardian-reports-e2e";
process.env.AGENTS_SERVICE_URL = "http://127.0.0.1:8999";

/** True se qualcosa risponde su host:port entro il timeout. */
function canConnect(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * Esportata perché i test la interrogano per auto-skipparsi: senza i servizi su
 * (`pnpm test:integration:up`) una suite e2e rossa non direbbe nulla sul codice.
 */
export async function servicesAvailable(): Promise<boolean> {
  const [mongo, redis] = await Promise.all([
    canConnect(MONGO_HOST, MONGO_PORT),
    canConnect(MONGO_HOST, REDIS_PORT),
  ]);
  return mongo && redis;
}

if (!(await servicesAvailable())) {
  console.warn(
    "\n[e2e] MongoDB (27018) e/o Redis (6380) non raggiungibili: i test e2e verranno saltati.\n" +
      "      Avviali con:  pnpm test:integration:up\n",
  );
}
