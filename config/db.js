const mongoose = require('mongoose');
const { MONGODB_URI } = require('./index');
const logger = require('../utils/logger');

async function connectDB() {
  try {
    if (!MONGODB_URI || !String(MONGODB_URI).trim()) {
      logger.error('MONGODB_URI not set');
      throw new Error('MONGODB_URI missing');
    }
    let info = {};
    try {
      const u = new URL(MONGODB_URI);
      info = { protocol: u.protocol, host: u.host, pathname: u.pathname };
    } catch (_) {}
    logger.info('Connecting to MongoDB', info);
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
    logger.info('MongoDB connected');
    try {
      mongoose.connection.on('error', (e) => logger.error('MongoDB connection event error', e));
      mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
      mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
    } catch (_) {}
  } catch (err) {
    logger.error('MongoDB connection error', err);
    throw err;
  }
}

module.exports = { connectDB };
