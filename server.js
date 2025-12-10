const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const logger = require('./utils/logger');

require('dotenv').config();
const config = require('./config');
const { connectDB, getDbDiagnostics } = require('./config/db');
const { authenticateToken } = require('./middlewares/auth');
const { errorHandler } = require('./middlewares/errorHandler');
const salesController = require('./controllers/salesController');
const User = require('./models/User');
const GlobalSetting = require('./models/GlobalSetting');

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
app.use(morgan('combined', {
  stream: { write: (message) => logger.info('http', { message: message.trim() }) }
}));
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





// JWT doğrulama middleware artık middlewares/auth içinden dahil ediliyor

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

// Sunucunun dış (egress) IP’sini öğrenmek için yardımcı endpoint
// Taşındı: /api/network/public-ip -> routes/network.js

// blocked-times POST endpoint routes/blockedTimes.js'e taşındı

// Müsait olmayan saatleri getir
// blocked-times GET endpoint routes/blockedTimes.js'e taşındı

// Müsait olmayan saati sil
// blocked-times DELETE endpoint routes/blockedTimes.js'e taşındı

// Kayıt olma
// auth register endpoint routes/auth.js'e taşındı

// Kayıt OTP başlatma (telefon doğrulaması olmadan kayıt tamamlanmaz)
// auth register-init endpoint routes/auth.js'e taşındı

// Kayıt OTP doğrulama ve kullanıcı oluşturma
// auth register-verify endpoint routes/auth.js'e taşındı




// Giriş yapma
// auth login endpoint routes/auth.js'e taşındı

// OTP doğrulama ve token oluşturma
// auth verify-otp endpoint routes/auth.js'e taşındı

// Kullanıcı profili
// auth profile endpoint routes/auth.js'e taşındı

// Taşındı: /api/plans GET -> routes/plans.js

// Taşındı: /api/premium/status GET -> routes/premium.js

// Taşındı: /api/premium/activate POST -> routes/premium.js




// RANDEVU ENDPOINT'LERİ taşındı: routes/appointments.js

// Tüm randevuları getir
// Taşındı: /api/appointments GET -> routes/appointments.js

// Yeni randevu oluştur
// Taşındı: /api/appointments POST -> routes/appointments.js

// SMS gönder (Mutlucell entegrasyonu)
// Taşındı: /api/sms/send -> routes/sms.js

// Randevu güncelle
// Taşındı: /api/appointments/:id PUT -> routes/appointments.js

// Randevu sil
// Taşındı: /api/appointments/:id DELETE -> routes/appointments.js

// Bugünkü randevuları getir
// Taşındı: /api/appointments/today GET -> routes/appointments.js

// Taşındı: /api/business POST -> routes/business.js

// İşletme bilgilerini getir
// Taşındı: /api/business GET -> routes/business.js







// İşletme bilgilerini güncelle
// Taşındı: /api/business PUT -> routes/business.js

// İşletme resimlerini güncelle (base64 format)
// Taşındı: /api/business/images PUT -> routes/business.js

// İşletme resimlerini sil
// Taşındı: /api/business/delete-images DELETE -> routes/business.js

// Taşındı: /api/business/upload-logo POST -> routes/business.js

// Taşındı: /api/business/delete-logo DELETE -> routes/business.js

// İstatistikleri getir
// Taşındı: /api/statistics -> routes/statistics.js

// Staff endpoints
// Personel ekleme
// Moved to routes/staff.js (createStaff)

// Personel listeleme
// Moved to routes/staff.js (listStaff)

// Personel güncelleme
// Moved to routes/staff.js (updateStaff)

// Personel çalışma saatleri güncelleme
// Moved to routes/staff.js (updateStaffWorkingHours)

// Personel silme
// Moved to routes/staff.js (deleteStaff)

// Avatar yükleme
// Moved to routes/staff.js (uploadStaffAvatar)

// Avatar silme
// Moved to routes/staff.js (deleteStaffAvatar)

// Moved to routes/services.js (getStaffServices)

// Personele hizmet ekleme endpoint'i
// Moved to routes/staff.js (addServiceToStaff)

// Personelden hizmet silme endpoint'i
// Moved to routes/staff.js (deleteServiceFromStaff)

// Moved to routes/services.js (getServices)

// Moved to routes/services.js (saveServices)

// Moved to routes/services.js (addService)

// Moved to routes/services.js (getUserServices)

// Moved to routes/services.js (updateService)

// Moved to routes/services.js (deleteService)

// Moved to routes/services.js (uploadServiceImagesMultiple)

// Moved to routes/services.js (uploadServiceImageSingle)

// Moved to routes/services.js (deleteServiceImage)

// Moved to routes/messageTemplates.js

// Customers endpoints
// Müşterileri getir
// Moved to routes/customers.js





// Mağaza ayarlarını getir
// Moved to routes/storeSettings.js

// Public mağaza verilerini getir (storeName ile)
// Taşındı: /api/public/store/:storeName GET -> routes/publicStore.js

// Taşındı: /api/public/store/:storeName/appointments POST -> routes/publicStore.js

// Moved to routes/publicStore.js: GET /api/public/store/:storeName/available-slots

// Moved to routes/publicStore.js: GET /api/public/store/:storeName/staff

// Moved to routes/publicStore.js: GET /api/public/store/:storeName/appointments

// Mağaza çalışma saatlerini getir (public endpoint)
// Moved to routes/publicStore.js: GET /api/public/store/:storeName/working-hours

// Moved to routes/publicStore.js: POST /api/public/store/:storeName/appointment-request

// Moved to routes/geocode.js: GET /api/geocode

// Moved to routes/geocode.js: GET /api/reverse-geocode

// Taşındı: /api/shorten POST -> routes/shortlinks.js

// Taşındı: /r/:id GET -> routes/shortlinks.js

// Taşındı: /api/contact-messages POST -> routes/contactMessages.js

// Moved to routes/appointmentRequests.js: POST /api/appointment-requests

// Moved to routes/appointmentRequests.js: PUT /api/appointment-requests/:requestId

// Moved to routes/appointmentRequests.js: GET /api/appointment-requests/:storeOwnerId

let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    logger.info(`Server ${PORT} portunda çalışıyor`);
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
      let totalProcessed = 0;
      let totalSent = 0;
      for (const owner of owners) {
        const fakeReq = { user: { userId: owner._id } };
        const fakeRes = {
          _status: 200,
          status(code) { this._status = code; return this; },
          json(payload) {
            try {
              totalProcessed += Number(payload?.processed || 0);
              totalSent += Number(payload?.sent || 0);
            } catch (_) {}
            return payload;
          }
        };
        try {
          await salesController.runSessionReminders(fakeReq, fakeRes);
        } catch (err) {
          logger.error('runSessionReminders çağrısı hata verdi', { ownerId: String(owner._id), error: err && err.message });
        }
      }
      logger.info('Seans hatırlatma işi tamamlandı', { owners: owners.length, processed: totalProcessed, sent: totalSent });
    } catch (error) {
      logger.error('Seans hatırlatma işi başarısız', { error: error && error.message });
    }
  }
  let sessionReminderTimeout = null;
  let sessionReminderInterval = null;
  async function getGeneralCronSettings() {
    try {
      const keys = ['sms_cron_enabled', 'sms_cron_hour', 'sms_cron_minute'];
      const docs = await GlobalSetting.find({ businessId: null, settingKey: { $in: keys } }).lean();
      const map = Object.fromEntries(docs.map(d => [d.settingKey, d.settingValue]));
      const enabled = String(map.sms_cron_enabled ?? 'true').toLowerCase() === 'true' || map.sms_cron_enabled === true;
      const hour = Number(map.sms_cron_hour ?? 2) || 2;
      const minute = Number(map.sms_cron_minute ?? 0) || 0;
      return { enabled, hour, minute };
    } catch (err) {
      return { enabled: config.ENABLE_SESSION_SMS_CRON, hour: config.SESSION_SMS_CRON_HOUR, minute: config.SESSION_SMS_CRON_MINUTE };
    }
  }
  function stopDailyReminders() {
    try { if (sessionReminderTimeout) { clearTimeout(sessionReminderTimeout); sessionReminderTimeout = null; } } catch (_) {}
    try { if (sessionReminderInterval) { clearInterval(sessionReminderInterval); sessionReminderInterval = null; } } catch (_) {}
  }
  async function startDailyReminders({ enabled, hour, minute, runOnStart }) {
    stopDailyReminders();
    try {
      if (!enabled) {
        logger.info('Seans SMS cron devre dışı');
        return;
      }
      const delay = msUntil(hour, minute);
      logger.info('Seans hatırlatma cron zamanlandı', { hour, minute, initialDelayMs: delay });
      sessionReminderTimeout = setTimeout(() => {
        runSessionRemindersForAllBusinesses().finally(() => {
          sessionReminderInterval = setInterval(runSessionRemindersForAllBusinesses, 24 * 60 * 60 * 1000);
        });
      }, delay);
      if (runOnStart) {
        runSessionRemindersForAllBusinesses();
      }
    } catch (err) {
      logger.error('Seans hatırlatma cron zamanlama hatası', { error: err && err.message });
    }
  }
  async function scheduleDailyReminders() {
    try {
      const { enabled, hour, minute } = await getGeneralCronSettings();
      await startDailyReminders({ enabled, hour, minute, runOnStart: config.SESSION_SMS_CRON_RUN_ON_START });
    } catch (err) {
      logger.error('Seans hatırlatma cron zamanlama hatası', { error: err && err.message });
    }
  }
  scheduleDailyReminders();
  try {
    global.__sessionReminderScheduler = {
      stop: stopDailyReminders,
      start: startDailyReminders,
      async reconfigure(newSettings) { await startDailyReminders({ enabled: !!newSettings.enabled, hour: Number(newSettings.hour) || 2, minute: Number(newSettings.minute) || 0, runOnStart: false }); },
      async loadAndSchedule() { const s = await getGeneralCronSettings(); await startDailyReminders({ enabled: s.enabled, hour: s.hour, minute: s.minute, runOnStart: false }); },
    };
  } catch (_) {}
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

// Randevuya ödeme ekle
// Taşındı: /api/appointments/:id/payments POST -> routes/appointments.js

// Taşındı: SMS gönderim servisleri -> services/smsService.js

module.exports = app;
