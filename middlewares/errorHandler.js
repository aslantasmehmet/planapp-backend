const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  try {
    logger.error('Request error', { path: req.originalUrl, method: req.method, message: err.message, stack: err.stack });
  } catch (_) {}
  res.status(500).json({ error: 'Sunucu hatası', details: err.message });
}

module.exports = { errorHandler };
