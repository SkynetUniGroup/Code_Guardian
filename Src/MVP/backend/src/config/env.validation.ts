import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),

  CORS_ORIGIN: Joi.string().uri().required(),

  MONGODB_URI: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),

  JWT_SECRET: Joi.string().min(16).required(),
  CREDENTIAL_MASTER_KEY: Joi.string().min(16).required(),
  INTERNAL_SHARED_SECRET: Joi.string().min(16).required(),

  // Anti-replay window (seconds) for HMAC-signed /internal/* requests: a
  // request whose X-Internal-Timestamp is further than this from "now" is
  // rejected, signature notwithstanding (PoC §6.3).
  HMAC_WINDOW_S: Joi.number().default(30),

  // RF.66: Tasks a single user may start per calendar month before
  // POST /tasks starts rejecting with 429 USAGE_LIMIT_EXCEEDED. Lives in
  // config, not the database, so raising it is a redeploy, not a migration.
  MONTHLY_TASK_LIMIT: Joi.number().default(50),
});
