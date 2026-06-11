import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  APP_ENV: Joi.string().valid('development', 'staging', 'production').default('development'),
  APP_PORT: Joi.number().default(3001),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  CORS_ORIGIN: Joi.string().required(),

  // Booking rules — hours before a schedule's start_time within which a
  // cancellation still refunds credit. Sourced here until the Settings module
  // (booking-rules) is built.
  BOOKING_CANCELLATION_WINDOW_HOURS: Joi.number().integer().min(0).default(12),

  // DOKU — validated at startup so missing keys surface immediately in staging/production
  DOKU_ENV: Joi.string().valid('sandbox', 'production').default('sandbox'),
  DOKU_CLIENT_ID: Joi.string().allow('').optional(),
  DOKU_SECRET_KEY: Joi.string().allow('').optional(),
  DOKU_MERCHANT_ID: Joi.string().allow('').optional(),
  DOKU_CHECKOUT_SANDBOX_URL: Joi.string().uri().optional(),
  DOKU_CHECKOUT_PRODUCTION_URL: Joi.string().uri().optional(),
  DOKU_CALLBACK_URL: Joi.string().uri().optional(),
  DOKU_RETURN_URL: Joi.string().uri().optional(),
  // Local-only: bypass the outbound DOKU network call for smoke testing. Never true in prod.
  DOKU_MOCK: Joi.boolean().truthy('true').falsy('false').default(false),
  // Local-only: emit temporary masked debug logs for the outbound checkout request
  // (masked Client-Id + DOKU response body). Keep false outside local troubleshooting.
  DOKU_DEBUG_LOGGING: Joi.boolean().truthy('true').falsy('false').default(false),
});
