import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  apiKeySecret: process.env.API_KEY_SECRET || 'default-secret-key',
  maxFileSize: process.env.MAX_FILE_SIZE || '50MB',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  webhookTimeout: parseInt(process.env.WEBHOOK_TIMEOUT, 10) || 5000,
  webhookMaxRetries: parseInt(process.env.WEBHOOK_MAX_RETRIES, 10) || 3,
  logLevel: process.env.LOG_LEVEL || 'debug',
}));