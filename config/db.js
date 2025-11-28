const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { MONGODB_URI } = require('./index');

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
    await mongoose.connect(MONGODB_URI, options);
    try { logger.info('MongoDB bağlantısı kuruldu'); } catch (_) {}
  } catch (err) {
    try { logger.error('MongoDB bağlantısı başarısız', err); } catch (_) {}
    throw err;
  }
}

mongoose.connection.on('connected', () => {
  try { logger.info('MongoDB connected'); } catch (_) {}
});
mongoose.connection.on('error', (err) => {
  try { logger.error('MongoDB connection error', err); } catch (_) {}
});
mongoose.connection.on('disconnected', () => {
  try { logger.warn('MongoDB disconnected'); } catch (_) {}
});

module.exports = { connectDB };
