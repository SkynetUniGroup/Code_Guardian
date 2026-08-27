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
});
