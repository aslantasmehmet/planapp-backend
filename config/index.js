require('dotenv').config();

const config = {
  PORT: process.env.PORT || 3001,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key',
  SHORTLINK_BASE_URL: process.env.SHORTLINK_BASE_URL || '',
  MUTLUCELL: {
    USERNAME: process.env.MUTLUCELL_USERNAME || '',
    PASSWORD: process.env.MUTLUCELL_PASSWORD || '',
    ORIGINATOR: process.env.MUTLUCELL_ORIGINATOR || '',
    API_URL: process.env.MUTLUCELL_API_URL || 'https://smsgw.mutlucell.com/xmlpost.asp',
    VALIDITY: process.env.MUTLUCELL_VALIDITY || '1440',
    ALLOW_INSECURE_TLS: String(process.env.MUTLUCELL_ALLOW_INSECURE_TLS || 'false').toLowerCase() === 'true',
  },
};

module.exports = config;

