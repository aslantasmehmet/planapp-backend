const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');

require('dotenv').config();
const config = require('./config');
const { connectDB, getDbDiagnostics } = require('./config/db');
const { errorHandler } = require('./middlewares/errorHandler');

const salesController = require('./controllers/salesController');
const User = require('./models/User');
const GlobalSetting = require('./models/GlobalSetting');

const app = express();

// ETag kapat
app.set('etag', false);
app.disable('x-powered-by');
const PORT = config.PORT || 3001;

// Proxy arkasında doğru bilgi
app.set('trust proxy', 1);

// DB Bağlantı
connectDB();

// Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);

// --- GÜNCELLENEN CORS AYARI ---
const defaultOrigins = [
  'http://localhost:8081',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://192.168.2.6:8081',
  'https://planyapp.com.tr',
];

const vercelPattern = /^https?:\/\/.*\.vercel\.app$/;

const envOrigins = Array.isArray(config.CORS_ORIGINS)
  ? config.CORS_ORIGINS
  : [];

const allowedOrigins = [...defaultOrigins, vercelPattern, ...envOrigins];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const ok = allowedOrigins.some((o) =>
        o instanceof RegExp ? o.test(origin) : o === origin
      );
      // Geliştirme aşamasında 403 hatasını önlemek için hata durumunda da true dönebilirsiniz:
      return ok ? callback(null, true) : callback(null, true); 
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// İstek İzleme Middleware (403 hatasını terminalde yakalamak için)
app.use((req, res, next) => {
  console.log(`➡️  [${req.method}] ${req.url} - Auth: ${req.headers.authorization ? 'Var' : 'YOK'}`);
  next();
});

const compression = require('compression');
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limit
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Geliştirme için artırıldı
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req.ip),
  validate: { trustProxy: false },
});
app.use('/api/auth', authLimiter);

// ROUTES
app.use('/api/auth', require('./routes/auth'));
app.use('/api/blocked-times', require('./routes/blockedTimes'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/message-templates', require('./routes/messageTemplates'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/customer-notes', require('./routes/customerNotes'));
app.use('/api/store', require('./routes/storeSettings'));
app.use('/api/public/store', require('./routes/publicStore'));
app.use('/api/settings', require('./routes/settings'));
app.use('/', require('./routes/geocode'));
app.use('/', require('./routes/appointmentRequests'));
app.use('/api/statistics', require('./routes/statistics'));
app.use('/', require('./routes/shortlinks'));
app.use('/', require('./routes/contactMessages'));
app.use('/', require('./routes/network'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/services', require('./routes/services'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/business', require('./routes/business'));
app.use('/api/premium', require('./routes/premium'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/cash', require('./routes/cash'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/features', require('./routes/features'));
app.use('/api/user-features', require('./routes/userFeatures'));

// Health check
app.get('/api/health', (req, res) => {
  try {
    const mongoState = mongoose.connection && mongoose.connection.readyState;
    const mongo = mongoState === 1 ? 'connected' : mongoState === 2 ? 'connecting' : 'disconnected';
    res.json({ status: 'OK', message: 'Server çalışıyor', mongo });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Test MongoDB
app.get('/api/test-mongo', async (req, res) => {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(500).json({ status: 'ERROR', message: 'MongoDB not connected' });
    }
    const pingResult = await mongoose.connection.db.admin().ping();
    return res.json({ status: 'OK', message: 'MongoDB connected', ping: pingResult });
  } catch (error) {
    return res.status(500).json({ status: 'ERROR', message: 'MongoDB ping failed', error });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Bulunamadı' });
});

app.use(errorHandler);

let server = null;

// --- ORİJİNAL ZAMANLAYICI VE STARTUP MANTIĞI ---
if (require.main === module) {
  // GÜNCELLEME: '0.0.0.0' eklenerek dış ağ erişimi sağlandı
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Sunucu http://192.168.2.6:${PORT} adresinde yayında`);
  });

  function msUntil(hour, minute) {
    const now = new Date();
    const next = new Date(now);
    next.setHours(Number(hour) || 2, Number(minute) || 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  async function runSessionRemindersForAllBusinesses() {
    try {
      const owners = await User.find({ userType: 'owner' }).select('_id');
      for (const owner of owners) {
        const fakeReq = { user: { userId: owner._id } };
        const fakeRes = {
          _status: 200,
          status(code) { this._status = code; return this; },
          json(payload) { return payload; },
        };
        await salesController.runSessionReminders(fakeReq, fakeRes);
      }
    } catch (error) {
      console.error("Reminder error:", error);
    }
  }

  let sessionReminderTimeout = null;
  let sessionReminderInterval = null;

  async function getGeneralCronSettings() {
    try {
      const keys = ['sms_cron_enabled', 'sms_cron_hour', 'sms_cron_minute'];
      const docs = await GlobalSetting.find({ businessId: null, settingKey: { $in: keys } }).lean();
      const map = Object.fromEntries(docs.map((d) => [d.settingKey, d.settingValue]));
      const enabled = String(map.sms_cron_enabled ?? 'true').toLowerCase() === 'true' || map.sms_cron_enabled === true;
      const hour = Number(map.sms_cron_hour ?? 2) || 2;
      const minute = Number(map.sms_cron_minute ?? 0) || 0;
      return { enabled, hour, minute };
    } catch (err) {
      return {
        enabled: config.ENABLE_SESSION_SMS_CRON,
        hour: config.SESSION_SMS_CRON_HOUR,
        minute: config.SESSION_SMS_CRON_MINUTE,
      };
    }
  }

  function stopDailyReminders() {
    if (sessionReminderTimeout) clearTimeout(sessionReminderTimeout);
    if (sessionReminderInterval) clearInterval(sessionReminderInterval);
  }

  async function startDailyReminders({ enabled, hour, minute, runOnStart }) {
    stopDailyReminders();
    if (!enabled) return;
    const delay = msUntil(hour, minute);
    sessionReminderTimeout = setTimeout(() => {
      runSessionRemindersForAllBusinesses().finally(() => {
        sessionReminderInterval = setInterval(runSessionRemindersForAllBusinesses, 24 * 60 * 60 * 1000);
      });
    }, delay);
    if (runOnStart) runSessionRemindersForAllBusinesses();
  }

  async function scheduleDailyReminders() {
    const { enabled, hour, minute } = await getGeneralCronSettings();
    await startDailyReminders({ enabled, hour, minute, runOnStart: config.SESSION_SMS_CRON_RUN_ON_START });
  }

  scheduleDailyReminders();

  global.__sessionReminderScheduler = {
    stop: stopDailyReminders,
    start: startDailyReminders,
    async reconfigure(newSettings) {
      await startDailyReminders({
        enabled: !!newSettings.enabled,
        hour: Number(newSettings.hour) || 2,
        minute: Number(newSettings.minute) || 0,
        runOnStart: false,
      });
    },
    async loadAndSchedule() {
      const s = await getGeneralCronSettings();
      await startDailyReminders({ enabled: s.enabled, hour: s.hour, minute: s.minute, runOnStart: false });
    },
  };

  function shutdown(signal) {
    server.close(() => {
      mongoose.connection.close(false).then(() => {
        process.exit(0);
      });
    });
    setTimeout(() => { process.exit(1); }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('uncaughtException', (err) => { console.error("Uncaught Exception:", err); });
process.on('unhandledRejection', (reason) => { console.error("Unhandled Rejection:", reason); });

module.exports = app;