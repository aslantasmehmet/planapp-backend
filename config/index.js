require('dotenv').config();

const config = {
  PORT: process.env.PORT || 3001,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key',
  SHORTLINK_BASE_URL: process.env.SHORTLINK_BASE_URL || '',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DISABLE_OTP_IN_DEV: String(process.env.DISABLE_OTP_IN_DEV || 'true').toLowerCase() === 'true',
  MUTLUCELL: {
    USERNAME: process.env.MUTLUCELL_USERNAME || '',
    PASSWORD: process.env.MUTLUCELL_PASSWORD || '',
    ORIGINATOR: process.env.MUTLUCELL_ORIGINATOR || '',
    API_URL: process.env.MUTLUCELL_API_URL || 'https://smsgw.mutlucell.com/xmlpost.asp',
    VALIDITY: process.env.MUTLUCELL_VALIDITY || '1440',
    ALLOW_INSECURE_TLS: String(process.env.MUTLUCELL_ALLOW_INSECURE_TLS || 'false').toLowerCase() === 'true',
  },
  ENABLE_SESSION_SMS_CRON: String(process.env.ENABLE_SESSION_SMS_CRON || 'true').toLowerCase() === 'true',
  SESSION_SMS_CRON_HOUR: Number(process.env.SESSION_SMS_CRON_HOUR ?? 2),
  SESSION_SMS_CRON_MINUTE: Number(process.env.SESSION_SMS_CRON_MINUTE ?? 0),
  SESSION_SMS_CRON_RUN_ON_START: String(process.env.SESSION_SMS_CRON_RUN_ON_START || 'false').toLowerCase() === 'true',
};

if (!config.MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is required');
}
if (!process.env.JWT_SECRET || config.JWT_SECRET === 'your-secret-key') {
  throw new Error('JWT_SECRET environment variable is required');
}

module.exports = config;
