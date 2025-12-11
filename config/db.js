const mongoose = require('mongoose');
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
    if (!MONGODB_URI) {
      return;
    }
    await mongoose.connect(MONGODB_URI, options);
  } catch (err) {
    lastDbError = err;
    throw err;
  }
}

mongoose.connection.on('error', (err) => {
  lastDbError = err;
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
