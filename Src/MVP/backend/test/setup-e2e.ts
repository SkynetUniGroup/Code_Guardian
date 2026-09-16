import { createConnection } from "node:net";

/**
 * E2e suite setup.
 *
 * Two tasks:
 *  1. point the app configuration to the services from docker-compose.test.yml
 *     (dedicated ports, throwaway database), before AppModule reads the env;
 *  2. clearly report if those services are not available, instead of
 *     crashing the suite with a Mongoose timeout that explains nothing.
 *
 * The file was referenced by vitest-e2e.config.mts but did not exist: the
 * e2e suite had never started.
 */

const MONGO_HOST = "127.0.0.1";
const MONGO_PORT = 27018;
const REDIS_PORT = 6380;

process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT ?? "3001";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.MONGODB_URI = `mongodb://${MONGO_HOST}:${MONGO_PORT}/codeguardian-e2e`;
process.env.REDIS_URL = `redis://${MONGO_HOST}:${REDIS_PORT}`;
// Fake but valid-length secrets: the Joi in env.validation.ts requires
// at least 16 characters, and without them the app does not even bootstrap.
process.env.JWT_SECRET = "e2e-jwt-secret-0123456789abcdef";
process.env.CREDENTIAL_MASTER_KEY = "e2e-credential-master-key-0123456789";
process.env.INTERNAL_SHARED_SECRET = "e2e-internal-shared-secret-0123456789";
process.env.S3_ACCESS_KEY_ID = "minioadmin";
process.env.S3_SECRET_ACCESS_KEY = "minioadmin";
process.env.S3_ENDPOINT = `http://${MONGO_HOST}:9002`;
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.REPORTS_BUCKET_NAME = "code-guardian-reports-e2e";
process.env.AGENTS_SERVICE_URL = "http://127.0.0.1:8999";

/** True if something responds on host:port within the timeout. */
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
 * Exported so tests can query it to auto-skip: without the services up
 * (`pnpm test:integration:up`) a red e2e suite would say nothing about the code.
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
    "\n[e2e] MongoDB (27018) and/or Redis (6380) not reachable: e2e tests will be skipped.\n" +
      "      Start them with:  pnpm test:integration:up\n",
  );
}
