const mongoose = require('mongoose');
const { MONGODB_URI } = require('./index');

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
  } catch (err) {
    throw err;
  }
}

module.exports = { connectDB };
