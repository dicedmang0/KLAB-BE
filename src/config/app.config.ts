import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  env: process.env.APP_ENV ?? 'development',
  port: parseInt(process.env.APP_PORT ?? '3001', 10),
  corsOrigin: (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()),
}));
