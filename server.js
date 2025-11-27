const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');
const logger = require('./utils/logger');

const User = require('./models/User');
const Appointment = require('./models/Appointment');
const Business = require('./models/Business');
const BlockedTime = require('./models/BlockedTime');
const AppointmentRequest = require('./models/AppointmentRequest');
const ContactMessage = require('./models/ContactMessage');
const SmsLog = require('./models/SmsLog');
const OtpCode = require('./models/OtpCode');
require('dotenv').config();
const config = require('./config');
const { connectDB } = require('./config/db');
const { authenticateToken } = require('./middlewares/auth');
const { errorHandler } = require('./middlewares/errorHandler');

const app = express();
// Dinamik JSON yanıtlarında 304 dönen ETag davranışını kapat
app.set('etag', false);
const PORT = config.PORT;
// Proxy arkasında doğru protokol/host bilgisi için
app.set('trust proxy', true);
// Basit bellek içi kısa-link depolama
const shortLinks = new Map();
const JWT_SECRET = config.JWT_SECRET;
// Mutlucell yapılandırmasını eski değişken adları ile eşleştir
const MUTLUCELL_USERNAME = config.MUTLUCELL.USERNAME;
const MUTLUCELL_PASSWORD = config.MUTLUCELL.PASSWORD;
const MUTLUCELL_ORIGINATOR = config.MUTLUCELL.ORIGINATOR;
const MUTLUCELL_API_URL = config.MUTLUCELL.API_URL;
const MUTLUCELL_VALIDITY = config.MUTLUCELL.VALIDITY; // dakika cinsinden
const MUTLUCELL_ALLOW_INSECURE_TLS = config.MUTLUCELL.ALLOW_INSECURE_TLS;
// Kısa linkler için public base URL (örn: https://planyapp.com.tr)
const SHORTLINK_BASE_URL = config.SHORTLINK_BASE_URL;

// MongoDB bağlantısı
connectDB();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://planyapp.com.tr',
    /^https?:\/\/.*\.vercel\.app$/
  ],
  credentials: true
}));
app.use(morgan('combined', {
  stream: { write: (message) => logger.info('http', { message: message.trim() }) }
}));
app.use(express.json({ limit: '10mb' })); // Base64 resimler için limit artırıldı
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Error handling middleware
app.use(errorHandler);





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
    res.json({ status: 'OK', message: 'Server çalışıyor' });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

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

app.listen(PORT, () => {
  logger.info(`Server ${PORT} portunda çalışıyor`);
});

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
