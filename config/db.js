const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { MONGODB_URI } = require('./index');

let lastDbError = null;
function sanitizeMongoUri(uri) {
  try {
    if (!uri) return 'undefined';
    return String(uri).replace(/:\S+@/, ':***@');
  } catch (_) {
    return 'invalid';
  }
}

mongoose.set('strictQuery', true);

const options = {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  retryWrites: true,
  autoIndex: false,
};

async function connectDB() {
  try {
    try { console.log('Mongo connecting to', sanitizeMongoUri(MONGODB_URI)); } catch (_) {}
    await mongoose.connect(MONGODB_URI, options);
    try { logger.info('MongoDB bağlantısı kuruldu'); } catch (_) {}
    try { console.log('Mongo connected'); } catch (_) {}
  } catch (err) {
    lastDbError = err;
    try { logger.error('MongoDB bağlantısı başarısız', err); } catch (_) {}
    try { console.error('Mongo connect error', err && err.message); } catch (_) {}
    throw err;
  }
}

mongoose.connection.on('connected', () => {
  try { logger.info('MongoDB connected'); } catch (_) {}
  try { console.log('Mongo event connected'); } catch (_) {}
});
mongoose.connection.on('error', (err) => {
  try { logger.error('MongoDB connection error', err); } catch (_) {}
  lastDbError = err;
  try { console.error('Mongo event error', err && err.message); } catch (_) {}
});
mongoose.connection.on('disconnected', () => {
  try { logger.warn('MongoDB disconnected'); } catch (_) {}
  try { console.error('Mongo event disconnected'); } catch (_) {}
});

function getDbDiagnostics() {
  try {
    const rs = mongoose.connection && typeof mongoose.connection.readyState === 'number' ? mongoose.connection.readyState : -1;
    const err = lastDbError ? { name: lastDbError.name, message: lastDbError.message, code: lastDbError.code } : null;
    return { readyState: rs, lastError: err, uri: sanitizeMongoUri(MONGODB_URI) };
  } catch (_) {
    return { readyState: -1, lastError: null, uri: 'unknown' };
  }
}

module.exports = { connectDB, getDbDiagnostics };
