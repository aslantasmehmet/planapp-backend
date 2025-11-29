const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const logger = require('./utils/logger'); // LOGLAMA MODÜLÜ KALDI

require('dotenv').config();
const config = require('./config');
const { connectDB, getDbDiagnostics } = require('./config/db');
const { authenticateToken } = require('./middlewares/auth');
const { errorHandler } = require('./middlewares/errorHandler');

const app = express();
// Dinamik JSON yanıtlarında 304 dönen ETag davranışını kapat
app.set('etag', false);
app.disable('x-powered-by');
const PORT = config.PORT;
// Proxy arkasında doğru protokol/host bilgisi için
app.set('trust proxy', 1);
const JWT_SECRET = config.JWT_SECRET;

// MongoDB bağlantısı
try { console.log('DB connect initiated', { hasUri: !!process.env.MONGODB_URI, hasJwt: !!process.env.JWT_SECRET }); } catch (_) {}
connectDB();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
const defaultOrigins = ['http://localhost:3000', 'http://localhost:3001', 'https://planyapp.com.tr'];
const vercelPattern = /^https?:\/\/.*\.vercel\.app$/;
const envOrigins = Array.isArray(config.CORS_ORIGINS) ? config.CORS_ORIGINS : [];
const allowedOrigins = [...defaultOrigins, vercelPattern, ...envOrigins];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const ok = allowedOrigins.some(o => (o instanceof RegExp ? o.test(origin) : o === origin));
    return ok ? callback(null, true) : callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// HATA GİDERME: morgan'ı sadece konsola yazacak şekilde düzenledik (EROFS hatasını engellemek için)
app.use(morgan('short')); 

const compression = require('compression');
app.use(compression());
app.use(express.json({ limit: '10mb' })); // Base64 resimler için limit artırıldı
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req.ip),
  validate: { trustProxy: false }
});
app.use('/api/auth', authLimiter);

// Routes
// Katmanlı mimari: taşınan route modüllerini bağla
 app.use('/api/auth', require('./routes/auth'));
 app.use('/api/blocked-times', require('./routes/blockedTimes'));
  app.use('/api/appointments', require('./routes/appointments'));
  app.use('/api/sms', require('./routes/sms'));
  app.use('/api/message-templates', require('./routes/messageTemplates'));
  app.use('/api/customers', require('./routes/customers'));
  app.use('/api/store', require('./routes/storeSettings'));
  app.use('/api/public/store', require('./routes/publicStore'));
  app.use('/', require('./routes/geocode'));
  app.use('/', require('./routes/appointmentRequests'));
  app.use('/api/statistics', require('./routes/statistics'));
  app.use('/', require('./routes/shortlinks'));
  app.use('/', require('./routes/contactMessages'));
  app.use('/', require('./routes/network'));
  app.use('/api/staff', require('./routes/staff'));
  app.use('/api/services', require('./routes/services'));
  app.use('/api/business', require('./routes/business'));
  app.use('/api/premium', require('./routes/premium'));
  app.use('/api/plans', require('./routes/plans'));
app.get('/api/health', (req, res) => {
  try {
    const mongoState = mongoose.connection && mongoose.connection.readyState;
    const mongo = mongoState === 1 ? 'connected' : (mongoState === 2 ? 'connecting' : 'disconnected');
    try {
      if (mongo !== 'connected') {
        const diag = getDbDiagnostics();
        console.log('Health check mongo state', { state: mongo, lastError: diag && diag.lastError && diag.lastError.message, uri: diag && diag.uri });
      }
    } catch (_) {}
    res.json({ status: 'OK', message: 'Server çalışıyor', mongo });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

app.get('/api/test-mongo', async (req, res) => {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(500).json({ status: 'ERROR', message: 'MongoDB not connected' });
    }
    let pingResult = null;
    try {
      pingResult = await mongoose.connection.db.admin().ping();
    } catch (_) {
      await mongoose.connection.db.listCollections().toArray();
      pingResult = { ok: 1 };
    }
    return res.json({ status: 'OK', message: 'MongoDB connected', ping: pingResult });
  } catch (error) {
    return res.status(500).json({ status: 'ERROR', message: 'MongoDB ping failed', error: error.message });
  }
});

// 404 yakalama
app.use((req, res) => {
  res.status(404).json({ error: 'Bulunamadı' });
});
app.use(errorHandler);

// Diğer tüm route ve middleware tanımları kaldırılmadı

let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    logger.info(`Server ${PORT} portunda çalışıyor`);
  });
  function shutdown(signal) {
    try {
      logger.warn(`Shutdown requested by ${signal}`);
      server.close(() => {
        try {
          mongoose.connection.close(false).then(() => {
            logger.info('MongoDB connection closed');
            process.exit(0);
          }).catch(() => process.exit(0));
        } catch (_) {
          process.exit(0);
        }
      });
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    } catch (_) {
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Global error handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise: 'unserializable' });
});

module.exports = app;
