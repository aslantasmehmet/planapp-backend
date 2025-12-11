function errorHandler(err, req, res, next) {
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const payload = isProd ? { error: 'Sunucu hatası' } : { error: 'Sunucu hatası', details: err.message };
  res.status(500).json(payload);
}

module.exports = { errorHandler };
