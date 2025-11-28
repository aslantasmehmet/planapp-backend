const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  try {
    logger.error('Request error', { path: req.originalUrl, method: req.method, message: err.message, stack: err.stack });
  } catch (_) {}
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const payload = isProd ? { error: 'Sunucu hatası' } : { error: 'Sunucu hatası', details: err.message };
  res.status(500).json(payload);
}

module.exports = { errorHandler };
