const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const User = require('./models/User');
const Appointment = require('./models/Appointment');
const Business = require('./models/Business');
const BlockedTime = require('./models/BlockedTime');
const AppointmentRequest = require('./models/AppointmentRequest');
const ContactMessage = require('./models/ContactMessage');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// MongoDB bağlantısı
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB bağlantısı başarılı'))
  .catch(err => console.error('MongoDB bağlantı hatası:', err));

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
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' })); // Base64 resimler için limit artırıldı
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express Error:', err);
  res.status(500).json({ error: 'Sunucu hatası', details: err.message });
});





// JWT doğrulama middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token gerekli' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Geçersiz token' });
    }
    req.user = user;
    next();
  });
};

// Routes
app.get('/api/health', (req, res) => {
  try {
    res.json({ status: 'OK', message: 'Server çalışıyor' });
  } catch (error) {
    console.error('Health endpoint hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Müsait olmayan saatler için API endpoint'leri
// Müsait olmayan saat ekle
app.post('/api/blocked-times', authenticateToken, async (req, res) => {
  try {
    const { date, startTime, endTime, reason } = req.body;
    
    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Tarih, başlangıç ve bitiş saati gereklidir' });
    }
    
    const blockedTime = new BlockedTime({
      userId: req.user.userId,
      businessId: req.user.businessId,
      date,
      startTime,
      endTime,
      reason: reason || 'Müsait değil'
    });
    
    await blockedTime.save();
    res.status(201).json(blockedTime);
  } catch (error) {
    console.error('Müsait olmayan saat ekleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası', details: error.message });
  }
});

// Müsait olmayan saatleri getir
app.get('/api/blocked-times', authenticateToken, async (req, res) => {
  try {
    const { date, userId } = req.query;
    
    const query = {
      businessId: req.user.businessId
    };
    
    if (date) {
      // Tarih filtreleme
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      
      query.date = { $gte: startDate, $lte: endDate };
    }
    
    if (userId) {
      query.userId = userId;
    }
    
    const blockedTimes = await BlockedTime.find(query).sort({ date: 1, startTime: 1 });
    res.json(blockedTimes);
  } catch (error) {
    console.error('Müsait olmayan saatleri getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası', details: error.message });
  }
});

// Müsait olmayan saati sil
app.delete('/api/blocked-times/:id', authenticateToken, async (req, res) => {
  try {
    const blockedTime = await BlockedTime.findById(req.params.id);
    
    if (!blockedTime) {
      return res.status(404).json({ error: 'Müsait olmayan saat bulunamadı' });
    }
    
    // Yetki kontrolü
    if (blockedTime.userId.toString() !== req.user.userId && 
        blockedTime.businessId.toString() !== req.user.businessId) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
    }
    
    await BlockedTime.findByIdAndDelete(req.params.id);
    res.json({ message: 'Müsait olmayan saat başarıyla silindi' });
  } catch (error) {
    console.error('Müsait olmayan saat silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası', details: error.message });
  }
});

// Kayıt olma
app.post('/api/auth/register', async (req, res) => {
  try {
    const { password, name, email, phone } = req.body;

    // Validasyon
    if (!password || !name || !email || !phone) {
      return res.status(400).json({ error: 'Ad, e-posta, telefon ve şifre alanları gereklidir' });
    }

    // E-posta zaten var mı kontrol et
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu e-posta adresi ile zaten bir hesap var' });
    }

    // Yeni kullanıcı oluştur
    const userData = { 
      name, 
      email, 
      phone, 
      password, 
      userType: 'owner',
      isPremium: false,
      trialStart: new Date()
    };
    
    const user = new User(userData);
    await user.save();
    
    // Owner kullanıcıları için businessId'yi kendi ID'si olarak ayarla
    if (user.userType === 'owner') {
      user.businessId = user._id;
      await user.save();
    }

    // JWT token oluştur - Türkçe karakterleri güvenli hale getir
    const token = jwt.sign(
      { 
        userId: user._id.toString(), 
        email: user.email,
        userType: user.userType
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Kullanıcı başarıyla oluşturuldu',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType,
        businessId: user.businessId,
        isPremium: user.isPremium,
        trialStart: user.trialStart
      }
    });
  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});





// Giriş yapma
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validasyon
    if (!email || !password) {
      return res.status(400).json({ error: 'E-posta ve şifre gereklidir' });
    }

    // E-postayı normalize et
    const emailNorm = String(email).toLowerCase().trim();

    // Kullanıcıyı bul
    const user = await User.findOne({ email: emailNorm });
    if (!user) {
      return res.status(404).json({ error: 'E-posta bulunamadı' });
    }

    // Şifreyi kontrol et (hata güvenli)
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Şifre yanlış' });
    }

    // JWT token oluştur
    const token = jwt.sign(
      { 
        userId: user._id.toString(), 
        email: user.email,
        userType: user.userType
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Giriş başarılı',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType,
        businessId: user.businessId
      }
    });
  } catch (error) {
    console.error('Giriş hatası:', error?.message || error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Kullanıcı profili
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    // Deneme bitiş tarihi ve durumunu hesapla (kayıt tarihine göre)
    const trialStart = user.createdAt;
    const TRIAL_DAYS = 7;
    const trialEndsAt = new Date(trialStart.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const now = new Date();
    const isTrialActive = !user.isPremium && now < trialEndsAt;
    const daysLeft = isTrialActive ? Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)) : 0;

    res.json({ 
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType,
        businessId: user.businessId,
        workingHours: user.workingHours,
        isPremium: user.isPremium,
        trialStart: trialStart,
        trialEndsAt: trialEndsAt,
        trialDaysLeft: daysLeft,
        trialActive: isTrialActive
      }
    });
  } catch (error) {
    console.error('Profil hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Korumalı planlar endpoint'i
app.get('/api/plans', authenticateToken, (req, res) => {
  res.json({
    message: 'Planlar başarıyla alındı',
    plans: ['Plan 1', 'Plan 2', 'Plan 3']
  });
});

// Premium durumunu getir
app.get('/api/premium/status', authenticateToken, async (req, res) => {
  try {
    const actor = await User.findById(req.user.userId);
    if (!actor) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    // Staff için owner'ı bul, owner ise kendisi hedef olur
    let target = actor;
    if (actor.userType === 'staff') {
      try {
        const bizDoc = await Business.findById(actor.businessId);
        if (bizDoc && bizDoc.ownerId) {
          const ownerDoc = await User.findById(bizDoc.ownerId);
          if (ownerDoc) target = ownerDoc;
        } else {
          const ownerCandidate = await User.findById(actor.businessId);
          if (ownerCandidate && ownerCandidate.userType === 'owner') {
            target = ownerCandidate;
          }
        }
      } catch (e) {
        console.warn('Owner çözümleme hatası (premium/status):', e.message);
      }
    }

    const now = new Date();
    const TRIAL_DAYS = 7;
    const trialStart = target.createdAt || new Date(0);
    const trialEndsAt = new Date(trialStart.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const trialActive = !target.isPremium && now < trialEndsAt;
    const daysLeft = trialActive ? Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)) : 0;

    // Üyelik ay bilgisi hesaplama (owner bazlı)
    let membershipCurrentMonth = 0;
    let membershipTotalMonths = target.membershipMonths || (target.planPeriod === 'annual' ? 12 : (target.planPeriod === 'monthly' ? 1 : 0));
    if (target.membershipStartedAt) {
      const start = new Date(target.membershipStartedAt);
      const monthsDiff = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
      membershipCurrentMonth = Math.min(Math.max(1, monthsDiff + 1), membershipTotalMonths || 12);
    }

    // Bu ay kullanılan randevu sayısı (işletme bazlı) - legacy ownerId fallback ile
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    let legacyOwnerId = null;
    if (actor.userType === 'owner') {
      legacyOwnerId = actor._id;
    } else {
      const bizDoc2 = await Business.findById(actor.businessId);
      if (bizDoc2 && bizDoc2.ownerId) {
        legacyOwnerId = bizDoc2.ownerId;
      } else {
        // Eski kayıtlarda businessId yanlışlıkla ownerId olarak tutulmuş olabilir
        const ownerCandidate2 = await User.findById(actor.businessId);
        if (ownerCandidate2 && ownerCandidate2.userType === 'owner') {
          legacyOwnerId = ownerCandidate2._id;
        }
      }
    }
    const businessIdQuery = legacyOwnerId && legacyOwnerId.toString() !== actor.businessId.toString()
      ? { $in: [actor.businessId, legacyOwnerId] }
      : actor.businessId;
    const countFromAppointmentsThisMonth = await Appointment.countDocuments({
      businessId: businessIdQuery,
      isBlocked: false,
      status: { $ne: 'cancelled' },
      $or: [
        { createdAt: { $gte: startOfMonth, $lte: endOfMonth } },
        { $and: [
          { createdAt: { $exists: false } },
          { date: { $gte: startOfMonth, $lte: endOfMonth } }
        ] }
      ]
    });
    const usedCountThisMonth = Math.max(
      Number.isFinite(target.usedAppointmentsThisMonth) ? target.usedAppointmentsThisMonth : 0,
      countFromAppointmentsThisMonth
    );

    console.log('🧮 PREMIUM STATUS DEBUG:', {
      actorUserId: actor._id?.toString(),
      targetUserId: target._id?.toString(),
      businessId: actor.businessId?.toString?.() || actor.businessId,
      planType: target.planType,
      planPeriod: target.planPeriod,
      isPremium: target.isPremium,
      monthlyQuotaRaw: target.monthlyQuota,
      usedAppointmentsThisMonthField: target.usedAppointmentsThisMonth,
      countFromAppointmentsThisMonth,
      usedCountThisMonth
    });

    // Yıllık üyelikte kullanılan randevu sayısı (üyelik dönemi)
    let usedCountThisYear = 0;
    if (target.planPeriod === 'annual' && target.membershipStartedAt && target.membershipEndsAt) {
      const membershipStart = new Date(target.membershipStartedAt);
      const membershipEnd = new Date(target.membershipEndsAt);
      usedCountThisYear = await Appointment.countDocuments({
        businessId: businessIdQuery,
        isBlocked: false,
        date: { $gte: membershipStart, $lte: membershipEnd },
        status: { $ne: 'cancelled' }
      });
    }

    // Plan bazlı efektif kota
    const planQuotaMap = { plus: 200, pro: 400, premium: null };
    let effectiveMonthlyQuota = planQuotaMap[target.planType] ?? target.monthlyQuota ?? null;
    // Üyelik süresi bitti mi?
    const membershipEndsAtDate = target.membershipEndsAt ? new Date(target.membershipEndsAt) : null;
    const membershipExpired = !!(membershipEndsAtDate && now >= membershipEndsAtDate);
    // Deneme bitti ve premium değilse => randevu hakkı 0 olmalı
    if (!target.isPremium && !trialActive) {
      effectiveMonthlyQuota = 0;
    }
    // Üyelik bitti ise kota tamamen 0 olmalı (sınırsız gösterimi kaldır)
    if (membershipExpired && !trialActive) {
      effectiveMonthlyQuota = 0;
    }
    // Üyelik bitti ise kalan hak 0 olmalı (kota null ise sınırsız gösterimi korunur)
    const remainingMonthly = effectiveMonthlyQuota == null
      ? null
      : (membershipExpired && !trialActive ? 0 : Math.max(effectiveMonthlyQuota - usedCountThisMonth, 0));

    res.json({
      isPremium: target.isPremium,
      planType: target.planType || null,
      planPeriod: target.planPeriod || null,
      membershipStartedAt: target.membershipStartedAt || null,
      membershipEndsAt: target.membershipEndsAt || null,
      membershipMonths: membershipTotalMonths,
      membershipCurrentMonth,
      monthlyQuota: effectiveMonthlyQuota,
      remaining: remainingMonthly,
      usedAppointmentsThisMonth: usedCountThisMonth,
      usedAppointmentsThisYear: usedCountThisYear,
      annualQuota: effectiveMonthlyQuota == null ? null : (membershipTotalMonths > 0 ? effectiveMonthlyQuota * membershipTotalMonths : null),
      lastResetAt: target.lastResetAt || null,
      trialStart,
      trialEndsAt,
      trialActive,
      trialDaysLeft: daysLeft
      ,
      membershipExpired
    });
  } catch (error) {
    console.error('Premium durumu hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Premium aktivasyon (satın alma simülasyonu)
app.post('/api/premium/activate', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const { plan, period } = req.body || {};
    const validPlans = ['plus', 'pro', 'premium'];
    const validPeriods = ['monthly', 'annual'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Geçersiz plan' });
    }
    const planPeriod = validPeriods.includes(period) ? period : 'monthly';

    const now = new Date();
    const months = planPeriod === 'annual' ? 12 : 1;
    const ends = new Date(now);
    ends.setMonth(ends.getMonth() + months);

    // Aylık kota (ileride enforcement için): plus=200, premium=400, pro=sınırsız
    let monthlyQuota = null;
    if (plan === 'plus') monthlyQuota = 200;
    if (plan === 'pro') monthlyQuota = 400;
    if (plan === 'premium') monthlyQuota = null; // null => sınırsız

    user.isPremium = true;
    user.premiumStartedAt = now;
    user.planType = plan;
    user.planPeriod = planPeriod;
    user.membershipStartedAt = now;
    user.membershipEndsAt = ends;
    user.membershipMonths = months;
    user.monthlyQuota = monthlyQuota;
    user.usedAppointmentsThisMonth = 0;
    user.lastResetAt = now;
    await user.save();

    res.json({ message: 'Üyelik aktif edildi', isPremium: true, planType: plan, planPeriod });
  } catch (error) {
    console.error('Premium aktivasyon hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});




// RANDEVU ENDPOINT'LERİ

// Randevu durumlarını otomatik güncelle (geçmiş randevular => completed)
const updateAppointmentStatuses = async (appointments) => {
  const now = new Date();
  const updatedAppointments = [];

  for (let appointment of appointments) {
    try {
      // İptal/bloke randevulara dokunma
      if (appointment?.status === 'cancelled' || appointment?.status === 'blocked' || appointment?.isBlocked === true) {
        updatedAppointments.push(appointment);
        continue;
      }

      // Tarih + bitiş saatinden Date oluştur
      const dateObj = new Date(appointment.date);
      let endDateTime = new Date(dateObj);

      const pickTime = (appointment.endTime || appointment.startTime || '23:59');
      const [hh, mm] = String(pickTime).split(':');
      const hours = Number(hh);
      const minutes = Number(mm || 0);
      endDateTime.setHours(Number.isFinite(hours) ? hours : 23, Number.isFinite(minutes) ? minutes : 59, 0, 0);

      let needsUpdate = false;
      let newStatus = appointment.status;

      // Geçmiş randevuysa ve completed değilse => completed
      if (endDateTime < now && appointment.status !== 'completed') {
        newStatus = 'completed';
        needsUpdate = true;
      }

      if (needsUpdate) {
        await Appointment.findByIdAndUpdate(appointment._id, { status: newStatus });
        appointment.status = newStatus;
      }

      updatedAppointments.push(appointment);
    } catch (e) {
      // Hata durumunda randevuyu değiştirmeden pushla
      updatedAppointments.push(appointment);
    }
  }

  return updatedAppointments;
};

// Tüm randevuları getir
app.get('/api/appointments', authenticateToken, async (req, res) => {
  try {
    // Kullanıcının businessId'sini al
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    // Kullanıcı tipine göre filtreleme
    let query = { businessId: user.businessId };
    const { staffId, serviceId } = req.query;
    
    // Staff sadece kendi oluşturduğu randevuları görebilir
    if (user.userType === 'staff') {
      query.createdBy = user._id;
      
      // Staff için serviceId parametresi varsa belirli hizmetin randevularını filtrele
      if (serviceId && serviceId !== 'all') {
        query.serviceId = serviceId;
      }
    } else if (user.userType === 'owner') {
      // Owner için staffId parametresi varsa belirli personelin randevularını filtrele
      if (staffId && staffId !== 'all') {
        query.createdBy = staffId;
      }
      // serviceId parametresi varsa belirli hizmetin randevularını filtrele
      if (serviceId && serviceId !== 'all') {
        query.serviceId = serviceId;
      }
      // staffId ve serviceId yoksa veya 'all' ise tüm randevuları göster (businessId filtrelemesi yeterli)
    }
    
    // Randevuları getir ve createdBy alanını populate et
    let appointments = await Appointment.find(query)
      .populate('createdBy', 'name email userType')
      .populate('userId', 'name email userType')
      .sort({ date: 1, startTime: 1 });
    
    // CreatedBy alanı eksik olan randevuları güncelle
    for (let appointment of appointments) {
      if (!appointment.createdBy) {
        // Eğer createdBy yoksa userId'yi kullan
        if (appointment.userId) {
          await Appointment.findByIdAndUpdate(appointment._id, {
            createdBy: appointment.userId
          });
          appointment.createdBy = await User.findById(appointment.userId).select('name email userType');
        }
      }
    }
    
    // Durumları otomatik güncelle
    appointments = await updateAppointmentStatuses(appointments);
    
    res.json({ appointments });
  } catch (error) {
    console.error('Randevuları getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Yeni randevu oluştur
app.post('/api/appointments', authenticateToken, async (req, res) => {
  try {
    // Kullanıcının businessId'sini al
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    // Staff ise owner'ı Business üzerinden bul; owner ise kendi ID'sini kullan
    let appointmentOwnerId = req.user.userId;
    if (user.userType === 'staff') {
      let ownerIdFromBusiness = null;
      let business = null;
      // CastError'ı önlemek için geçerli ObjectId kontrolü
      try {
        if (user.businessId && mongoose.Types.ObjectId.isValid(user.businessId.toString())) {
          business = await Business.findById(user.businessId);
        }
      } catch (e) {
        console.warn('Business findById hata (staff):', e.message);
      }
      if (business && business.ownerId && mongoose.Types.ObjectId.isValid(business.ownerId.toString())) {
        ownerIdFromBusiness = business.ownerId;
      } else {
        // Eski kayıtlar için fallback: businessId yanlışlıkla ownerId olabilir
        try {
          if (user.businessId && mongoose.Types.ObjectId.isValid(user.businessId.toString())) {
            const ownerFallback = await User.findOne({ _id: user.businessId, userType: 'owner' });
            if (ownerFallback) {
              ownerIdFromBusiness = ownerFallback._id;
              // Staff kaydını düzeltmeye çalış: doğru businessId'yi bul ve yaz
              const maybeBiz = await Business.findOne({ ownerId: ownerFallback._id });
              if (maybeBiz) {
                try { await User.findByIdAndUpdate(user._id, { businessId: maybeBiz._id }); } catch (e2) { console.error('Staff businessId düzeltme hatası:', e2); }
              }
            }
          }
        } catch (e) {
          console.warn('Owner fallback arama hata (staff):', e.message);
        }
      }
      if (ownerIdFromBusiness) {
        appointmentOwnerId = ownerIdFromBusiness;
      }
    }

    // Owner için selectedStaff parametresi varsa o staff adına randevu oluştur
    let createdById = req.user.userId;
    if (user.userType === 'owner' && req.body.selectedStaff && req.body.selectedStaff !== 'all') {
      createdById = req.body.selectedStaff;
    }

    // Kota enforcement: Premium üyelikte aylık kota dolmuşsa veya deneme bittiyse yeni randevuyu engelle
    // Önce deneme süresi bitti mi kesin olarak kontrol et (fail-closed)
    const planQuotaMap = { plus: 200, pro: 400, premium: null };
    const isBlockedAppointment = !!req.body.isBlocked;
    // Kota/deneme kontrolünü işletme sahibine göre yap; staff için owner'ı çıkar
    let ownerDoc = null;
    if (user.userType === 'staff') {
      try {
        const bizDocForOwner = await Business.findById(user.businessId);
        if (bizDocForOwner && bizDocForOwner.ownerId) {
          ownerDoc = await User.findById(bizDocForOwner.ownerId);
        } else {
          const ownerCandidate = await User.findById(user.businessId);
          if (ownerCandidate && ownerCandidate.userType === 'owner') {
            ownerDoc = ownerCandidate;
          }
        }
      } catch (e) {
        console.warn('Owner çözümleme hatası (pre-enforcement):', e.message);
      }
      if (!ownerDoc && !isBlockedAppointment) {
        return res.status(403).json({ error: 'İşletme sahibi bulunamadı. Lütfen işletme ayarlarınızı kontrol edin.' });
      }
    }
    const enforcementTarget = ownerDoc || user;
    const now = new Date();
    const TRIAL_DAYS = 7;
    const trialStartLocal = enforcementTarget.createdAt || new Date(0);
    const trialEndsAtLocal = new Date(trialStartLocal.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    console.log('🧭 ENFORCEMENT TARGET DEBUG:', {
      actorUserId: user._id?.toString(),
      ownerUserId: ownerDoc?._id?.toString() || null,
      targetUserId: enforcementTarget._id?.toString?.() || enforcementTarget._id,
      isPremium: !!enforcementTarget.isPremium,
      trialStart: trialStartLocal,
      trialEndsAt: trialEndsAtLocal,
      now
    });
    if (!enforcementTarget.isPremium && now >= trialEndsAtLocal && !isBlockedAppointment) {
      console.log('🧮 ENFORCEMENT DEBUG (TRIAL FAIL-CLOSED):', {
        actorUserId: user._id?.toString(),
        ownerUserId: ownerDoc?._id?.toString() || null,
        isPremium: !!enforcementTarget.isPremium,
        trialEnded: now >= trialEndsAtLocal,
        isBlockedAppointment,
        decision: 'BLOCK_CREATE_APPOINTMENT'
      });
      return res.status(403).json({ error: 'Deneme süreniz bitti. Paket satın almadan randevu oluşturamazsınız.' });
    }

    // Üyelik süresi bitti ise randevu oluşturmayı engelle
    try {
      const membershipEndsAtLocal = enforcementTarget.membershipEndsAt ? new Date(enforcementTarget.membershipEndsAt) : null;
      const membershipExpiredLocal = !!(membershipEndsAtLocal && now >= membershipEndsAtLocal);
      if (membershipExpiredLocal && !isBlockedAppointment) {
        console.log('🛑 ENFORCEMENT DEBUG (MEMBERSHIP EXPIRED):', {
          actorUserId: user._id?.toString(),
          ownerUserId: ownerDoc?._id?.toString() || null,
          membershipEndsAt: membershipEndsAtLocal,
          now,
          decision: 'BLOCK_CREATE_APPOINTMENT'
        });
        return res.status(403).json({ error: 'Üyelik süreniz sona erdi. Paket yenilenmeden randevu oluşturamazsınız.' });
      }
    } catch (expErr) {
      console.warn('Üyelik bitiş kontrol hatası:', expErr);
    }

    // Aylık kota kontrolünü ayrı bir blokta yap; hata olursa logla
    try {
      const effectiveMonthlyQuota = planQuotaMap[enforcementTarget.planType] ?? enforcementTarget.monthlyQuota ?? null;

      if (enforcementTarget.isPremium && effectiveMonthlyQuota != null && !isBlockedAppointment) {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        let legacyOwnerId = null;
        if (user.userType === 'owner') {
          legacyOwnerId = user._id;
        } else {
          let bizDoc = null;
          try {
            if (user.businessId && mongoose.Types.ObjectId.isValid(user.businessId.toString())) {
              bizDoc = await Business.findById(user.businessId);
            }
          } catch (e) {
            console.warn('Business findById hata (quota count):', e.message);
          }
          if (bizDoc && bizDoc.ownerId && mongoose.Types.ObjectId.isValid(bizDoc.ownerId.toString())) {
            legacyOwnerId = bizDoc.ownerId;
          } else {
            try {
              if (user.businessId && mongoose.Types.ObjectId.isValid(user.businessId.toString())) {
                const ownerCandidate = await User.findById(user.businessId);
                if (ownerCandidate && ownerCandidate.userType === 'owner') {
                  legacyOwnerId = ownerCandidate._id;
                }
              }
            } catch (e) {
              console.warn('Owner candidate arama hata (quota count):', e.message);
            }
          }
        }
        const legacyOwnerIdStr = legacyOwnerId?.toString?.();
        const businessIdStr = user.businessId?.toString?.() || String(user.businessId);
        const businessIdQuery = legacyOwnerIdStr && legacyOwnerIdStr !== businessIdStr
          ? { $in: [user.businessId, legacyOwnerId] }
          : user.businessId;
        const usedCountThisMonth = await Appointment.countDocuments({
          businessId: businessIdQuery,
          isBlocked: false,
          status: { $ne: 'cancelled' },
          $or: [
            { createdAt: { $gte: startOfMonth, $lte: endOfMonth } },
            { $and: [
              { createdAt: { $exists: false } },
              { date: { $gte: startOfMonth, $lte: endOfMonth } }
            ] }
          ]
        });
        console.log('🧮 ENFORCEMENT DEBUG:', {
          actorUserId: user._id?.toString(),
          ownerUserId: ownerDoc?._id?.toString() || null,
          businessId: user.businessId?.toString?.() || user.businessId,
          planType: enforcementTarget.planType,
          effectiveMonthlyQuota,
          usedCountThisMonth,
          willBlock: usedCountThisMonth >= effectiveMonthlyQuota
        });
        if (usedCountThisMonth >= effectiveMonthlyQuota) {
          return res.status(403).json({ error: 'Aylık randevu hakkınız doldu. Lütfen paket yükseltin veya yeni dönem başlayınca tekrar deneyin.' });
        }
      }
    } catch (quotaErr) {
      console.error('Kota kontrolü sırasında hata:', quotaErr);
      // Kota kontrolü başarısız olsa bile randevu oluşturmayı tamamen engellemeyelim
      // Devam ederek randevuyu oluşturalım fakat hata loglansın
    }

    // Bloke edilmiş randevu ise gerekli alanları ayarla
    if (req.body.isBlocked) {
      // Bloke edilmiş randevular için status alanını 'blocked' olarak ayarla
      req.body.status = 'blocked';
      
      // Eğer title/service belirtilmemişse varsayılan değer ata
      if (!req.body.title || req.body.title.trim() === '') {
        req.body.title = 'Bloke Edilmiş Saat';
      }
      if (!req.body.service || req.body.service.trim() === '') {
        req.body.service = 'Bloke Edilmiş Saat';
      }
      if (!req.body.type || req.body.type.trim() === '') {
        req.body.type = 'Bloke Edilmiş Saat';
      }
    }

    const appointmentData = {
      ...req.body,
      userId: appointmentOwnerId, // Randevunun sahibi (owner)
      businessId: user.businessId,
      createdBy: createdById // Randevuyu oluşturan kişi (staff veya owner, ya da owner tarafından seçilen staff)
    };
    
    // selectedStaff alanını appointmentData'dan çıkar (MongoDB'ye kaydedilmemeli)
    delete appointmentData.selectedStaff;
    
    const appointment = new Appointment(appointmentData);
    await appointment.save();
    // Başarılı oluşturma sonrası: premium pakette aylık kullanım sayacını artır
    try {
      const planQuotaMap = { plus: 200, pro: 400, premium: null };
      // Staff ise owner'ın planına göre sayaç artışı yap
      let ownerDocForIncrement = null;
      if (user.userType === 'staff') {
        const bizDocForOwner2 = await Business.findById(user.businessId);
        if (bizDocForOwner2 && bizDocForOwner2.ownerId) {
          ownerDocForIncrement = await User.findById(bizDocForOwner2.ownerId);
        } else {
          const ownerCandidate2 = await User.findById(user.businessId);
          if (ownerCandidate2 && ownerCandidate2.userType === 'owner') {
            ownerDocForIncrement = ownerCandidate2;
          }
        }
      }
      const targetUser = ownerDocForIncrement || user;
      const effectiveMonthlyQuotaInc = planQuotaMap[targetUser.planType] ?? targetUser.monthlyQuota ?? null;
      const shouldIncrement = !!targetUser.isPremium && effectiveMonthlyQuotaInc != null && !appointment.isBlocked;
      if (shouldIncrement) {
        const now2 = new Date();
        // Eğer sayaç ay başından bu yana resetlenmemişse basitçe 1 artır
        await User.findByIdAndUpdate(targetUser._id, { $inc: { usedAppointmentsThisMonth: 1 }, lastResetAt: targetUser.lastResetAt || now2 });
      }
    } catch (incErr) {
      console.warn('Aylık kullanım sayaç artırma hatası:', incErr);
    }
    console.log('✅ APPOINTMENT CREATED DEBUG:', {
      appointmentId: appointment._id?.toString?.() || appointment._id,
      businessId: appointment.businessId?.toString?.() || appointment.businessId,
      userId: appointment.userId?.toString?.() || appointment.userId,
      createdBy: appointment.createdBy?.toString?.() || appointment.createdBy,
      isBlocked: appointment.isBlocked,
      status: appointment.status,
      createdAt: appointment.createdAt
    });
    
    res.status(201).json({
      message: 'Randevu başarıyla oluşturuldu',
      appointment
    });
  } catch (error) {
    console.error('Randevu oluşturma hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Randevu güncelle
app.put('/api/appointments/:id', authenticateToken, async (req, res) => {
  try {
    // Kullanıcının businessId'sini al
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    // Yetki kontrolü: Owner tüm randevuları güncelleyebilir, staff sadece kendi oluşturduklarını
    let query = { _id: req.params.id, businessId: user.businessId };
    if (user.userType === 'staff') {
      query.createdBy = user._id;
    }

    // Önce mevcut randevuyu bul
    const existing = await Appointment.findOne(query);
    if (!existing) {
      return res.status(404).json({ error: 'Randevu bulunamadı veya yetkiniz yok' });
    }

    // Geçmiş tarih/saat için güncelleme engeli
    try {
      const effectiveDate = req.body.date ? new Date(req.body.date) : new Date(existing.date);
      const pickTime = req.body.endTime || req.body.startTime || existing.endTime || existing.startTime || '23:59';
      const [hh, mm] = String(pickTime).split(':');
      const hours = Number(hh);
      const minutes = Number(mm || 0);
      const endDateTime = new Date(effectiveDate);
      endDateTime.setHours(Number.isFinite(hours) ? hours : 23, Number.isFinite(minutes) ? minutes : 59, 0, 0);

      if (endDateTime < new Date()) {
        return res.status(400).json({ error: 'Geçmiş tarih/saat için randevu güncellenemez' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Geçersiz tarih/saat formatı' });
    }

    // Yarım saatlik zaman adımı doğrulaması (sadece saat alanları güncelleniyorsa uygula)
    const isHalfHour = (t) => {
      if (!t) return true;
      const parts = String(t).split(':');
      if (parts.length < 2) return false;
      const mins = Number(parts[1]);
      return mins === 0 || mins === 30;
    };

    if (typeof req.body.startTime !== 'undefined' && !isHalfHour(req.body.startTime)) {
      return res.status(400).json({ error: 'Başlangıç saati 30 dakikalık adımlarda olmalıdır (örn. 08:00, 08:30).' });
    }
    if (typeof req.body.endTime !== 'undefined' && !isHalfHour(req.body.endTime)) {
      return res.status(400).json({ error: 'Bitiş saati 30 dakikalık adımlarda olmalıdır (örn. 08:00, 08:30).' });
    }

    // Randevuyu güncelle
    const appointment = await Appointment.findOneAndUpdate(query, req.body, { new: true });
    
    if (!appointment) {
      return res.status(404).json({ error: 'Randevu bulunamadı veya yetkiniz yok' });
    }
    
    res.json({
      message: 'Randevu başarıyla güncellendi',
      appointment
    });
  } catch (error) {
    console.error('Randevu güncelleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Randevu sil
app.delete('/api/appointments/:id', authenticateToken, async (req, res) => {
  try {
    // Kullanıcının businessId'sini al
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    // Yetki kontrolü: Owner tüm randevuları silebilir, staff sadece kendi oluşturduklarını
    let query = { _id: req.params.id, businessId: user.businessId };
    if (user.userType === 'staff') {
      query.createdBy = user._id;
    }

    // Randevuyu sil
    const appointment = await Appointment.findOneAndDelete(query);
    
    if (!appointment) {
      return res.status(404).json({ error: 'Randevu bulunamadı veya yetkiniz yok' });
    }
    
    res.json({ message: 'Randevu başarıyla silindi' });
  } catch (error) {
    console.error('Randevu silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Bugünkü randevuları getir
app.get('/api/appointments/today', authenticateToken, async (req, res) => {
  try {
    // Kullanıcının businessId'sini al
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Kullanıcı tipine göre filtreleme
    let query = {
      businessId: user.businessId,
      date: {
        $gte: today,
        $lt: tomorrow
      }
    };
    
    // Owner tüm randevuları görebilir, staff sadece kendi oluşturduklarını
    if (user.userType === 'staff') {
      query.createdBy = user._id;
    }
    // Owner için filtreleme yok - tüm işletme randevularını görebilir
    
    // Bugünkü randevuları getir ve createdBy alanını populate et
    let appointments = await Appointment.find(query)
      .populate('createdBy', 'name email userType')
      .sort({ startTime: 1 });
    
    // Durumları otomatik güncelle
    appointments = await updateAppointmentStatuses(appointments);
    
    res.json({ appointments });
  } catch (error) {
    console.error('Bugünkü randevuları getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// İşletme bilgileri oluştur
app.post('/api/business', authenticateToken, async (req, res) => {
  try {
    const { name, address, phone, email, businessType, description, workingHours } = req.body;

    // Validasyon
    if (!name || !address || !phone || !businessType) {
      return res.status(400).json({ error: 'İşletme adı, adres, telefon ve işletme türü gereklidir' });
    }

    // Kullanıcının zaten bir işletmesi var mı kontrol et
    const existingBusiness = await Business.findOne({ ownerId: req.user.userId });
    if (existingBusiness) {
      return res.status(400).json({ error: 'Zaten bir işletmeniz var' });
    }

    // Yeni işletme oluştur
    const businessData = {
      name,
      address,
      phone,
      email,
      businessType,
      description,
      workingHours,
      ownerId: req.user.userId
    };
    
    const business = new Business(businessData);
    await business.save();

    // Owner kullanıcının businessId alanını yeni oluşturulan işletmenin ID'si ile güncelle
    try {
      await User.findByIdAndUpdate(
        req.user.userId,
        { businessId: business._id },
        { new: true }
      );
    } catch (e) {
      console.error('Owner businessId güncelleme hatası:', e);
    }

    res.status(201).json({
      success: true,
      message: 'İşletme bilgileri başarıyla kaydedildi',
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        businessType: business.businessType,
        description: business.description,
        workingHours: business.workingHours
      }
    });
  } catch (error) {
    console.error('İşletme oluşturma hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// İşletme bilgilerini getir
app.get('/api/business', authenticateToken, async (req, res) => {
  try {
    
    // Kullanıcı bilgilerini al
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }


    let business;
    
    if (user.userType === 'owner') {
      // Owner ise kendi işletme bilgilerini getir
      business = await Business.findOne({ ownerId: req.user.userId });
    } else if (user.userType === 'staff') {
      // Staff ise owner'ın işletme bilgilerini getir
      if (!user.businessId) {
        return res.json({
          business: null,
          message: 'Staff kullanıcısının işletme bilgisi bulunamadı'
        });
      }
      
      // Staff için businessId doğrudan Business._id olmalı
      business = await Business.findById(user.businessId);
      if (!business) {
        // Eski kayıtlarda businessId yanlışlıkla ownerId olarak tutulmuş olabilir
        const fallbackBiz = await Business.findOne({ ownerId: user.businessId });
        if (fallbackBiz) {
          business = fallbackBiz;
          // Staff kaydını düzelt: businessId alanını gerçek Business._id ile güncelle
          try {
            await User.findByIdAndUpdate(user._id, { businessId: fallbackBiz._id });
          } catch (e) {
            console.error('Staff businessId düzeltme hatası:', e);
          }
        }
      }
    }
    
    if (!business) {
      return res.json({
        business: null,
        message: 'İşletme bilgisi bulunamadı'
      });
    }


    res.json({
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        businessType: business.businessType,
        description: business.description,
        logo: business.logo,
        workingHours: business.workingHours,
        images: business.images || [],
        isActive: business.isActive
      }
    });
  } catch (error) {
    console.error('❌ BACKEND: İşletme bilgilerini getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});







// İşletme bilgilerini güncelle
app.put('/api/business', authenticateToken, async (req, res) => {
  try {
    const { name, address, phone, email, businessType, description, workingHours } = req.body;

    const business = await Business.findOne({ ownerId: req.user.userId });
    
    if (!business) {
      return res.status(404).json({ error: 'İşletme bilgisi bulunamadı' });
    }

    // Güncelleme
    if (name) business.name = name;
    if (address) business.address = address;
    if (phone) business.phone = phone;
    if (email) business.email = email;
    if (businessType) business.businessType = businessType;
    if (description) business.description = description;
    if (workingHours) business.workingHours = workingHours;

    await business.save();

    res.json({
      success: true,
      message: 'İşletme bilgileri başarıyla güncellendi',
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        businessType: business.businessType,
        description: business.description,
        workingHours: business.workingHours
      }
    });
  } catch (error) {
    console.error('İşletme güncelleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// İşletme resimlerini güncelle (base64 format)
app.put('/api/business/images', authenticateToken, async (req, res) => {
  try {
    
    const { images } = req.body;

    if (!images || !Array.isArray(images)) {
      return res.status(400).json({ error: 'Geçerli resim verisi gerekli' });
    }

    if (images.length > 5) {
      return res.status(400).json({ error: 'Maksimum 5 resim yüklenebilir' });
    }


    const business = await Business.findOne({ ownerId: req.user.userId });
    
    if (!business) {
      return res.status(404).json({ error: 'İşletme bilgisi bulunamadı' });
    }


    // Base64 resimlerini kaydet
    business.images = images;
    await business.save();


    res.json({
      success: true,
      message: 'Resimler başarıyla güncellendi',
      images: business.images
    });
  } catch (error) {
    console.error('❌ BACKEND: Resim güncelleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// İşletme resimlerini sil
app.delete('/api/business/delete-images', authenticateToken, async (req, res) => {
  try {
    const business = await Business.findOne({ ownerId: req.user.userId });
    
    if (!business) {
      return res.status(404).json({ error: 'İşletme bilgisi bulunamadı' });
    }

    // Veritabanından resim kayıtlarını temizle (base64 format için dosya silme gereksiz)
    business.images = [];
    await business.save();

    res.json({
      success: true,
      message: 'Tüm resimler başarıyla silindi'
    });
  } catch (error) {
    console.error('Resim silme hatası:', error);
    res.status(500).json({ error: 'Resim silme hatası', details: error.message });
  }
});

// Logo yükleme endpoint'i
app.post('/api/business/upload-logo', authenticateToken, async (req, res) => {
  try {

    if (!req.body.logo) {
      return res.status(400).json({ error: 'Logo verisi gönderilmedi' });
    }

    // Kullanıcının business kaydını bul
    const business = await Business.findOne({ ownerId: req.user.userId });
    if (!business) {
      return res.status(404).json({ error: 'İşletme kaydı bulunamadı' });
    }

    // Business kaydını güncelle
    business.logo = req.body.logo;
    await business.save();


    res.json({
      success: true,
      message: 'Logo başarıyla yüklendi',
      logoUrl: req.body.logo,
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        logo: business.logo,
        workingHours: business.workingHours,
        images: business.images,
        isActive: business.isActive
      }
    });

  } catch (error) {
    console.error('❌ BACKEND: Logo yükleme hatası:', error);
    res.status(500).json({ error: 'Logo yüklenirken hata oluştu', details: error.message });
  }
});

// Logo silme endpoint'i
app.delete('/api/business/delete-logo', authenticateToken, async (req, res) => {
  try {

    // Kullanıcının business kaydını bul
    const business = await Business.findOne({ ownerId: req.user.userId });
    if (!business) {
      return res.status(404).json({ error: 'İşletme kaydı bulunamadı' });
    }

    // Logo dosyasını sil (varsa)
    if (business.logo) {
      const logoPath = path.join(__dirname, 'uploads', path.basename(business.logo));
      if (fs.existsSync(logoPath)) {
        fs.unlinkSync(logoPath);
      }
    }

    // Business kaydından logo'yu kaldır
    business.logo = '';
    await business.save();


    res.json({
      success: true,
      message: 'Logo başarıyla silindi',
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        logo: business.logo,
        workingHours: business.workingHours,
        images: business.images,
        isActive: business.isActive
      }
    });

  } catch (error) {
    console.error('❌ BACKEND: Logo silme hatası:', error);
    res.status(500).json({ error: 'Logo silinirken hata oluştu', details: error.message });
  }
});

// İstatistikleri getir
app.get('/api/statistics', authenticateToken, async (req, res) => {
  try {
    // Kullanıcının businessId'sini al
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Kullanıcı tipine göre filtreleme
    let baseQuery = { businessId: user.businessId };
    if (user.userType === 'staff') {
      baseQuery.createdBy = user._id;
    }
    
    // Bugünkü randevular
    const todayAppointments = await Appointment.countDocuments({
      ...baseQuery,
      date: {
        $gte: today,
        $lt: tomorrow
      }
    });
    
    // Bu haftaki randevular
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    
    const weeklyAppointments = await Appointment.countDocuments({
      ...baseQuery,
      date: {
        $gte: startOfWeek,
        $lt: endOfWeek
      }
    });
    
    // Tamamlanan randevular
    const completedAppointments = await Appointment.countDocuments({
      ...baseQuery,
      status: 'completed'
    });
    
    res.json({
      statistics: {
        todayAppointments,
        weeklyPlans: weeklyAppointments,
        completedTasks: completedAppointments
      }
    });
  } catch (error) {
    console.error('İstatistik hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Staff endpoints
// Personel ekleme
app.post('/api/staff', authenticateToken, async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const ownerId = req.user.userId;

    // Validasyon
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'Tüm alanlar gereklidir' });
    }

    // Owner'ın business bilgisini al
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel ekleyebilir' });
    }

    // E-posta zaten var mı kontrol et
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu e-posta adresi ile zaten bir hesap var' });
    }

    // Yeni personel oluştur
    const staffData = {
      name,
      email,
      phone,
      password,
      userType: 'staff',
      businessId: owner.businessId,
      createdBy: ownerId
    };
    
    const staff = new User(staffData);
    await staff.save();

    res.status(201).json({
      message: 'Personel başarıyla eklendi',
      staff: {
        id: staff._id,
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        userType: staff.userType,
        businessId: staff.businessId,
        createdAt: staff.createdAt
      }
    });
  } catch (error) {
    console.error('Personel ekleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Personel listeleme
app.get('/api/staff', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    let staffList;
    if (user.userType === 'owner') {
      // Owner ise kendi eklediği personelleri listele
      staffList = await User.find({
        userType: 'staff',
        createdBy: userId
      }).select('-password').sort({ createdAt: -1 });
    } else {
      // Staff ise aynı işletmedeki diğer personelleri listele
      staffList = await User.find({
        userType: 'staff',
        businessId: user.businessId,
        _id: { $ne: userId } // Kendisi hariç
      }).select('-password').sort({ createdAt: -1 });
    }

    res.json({ staff: staffList });
  } catch (error) {
    console.error('Personel listeleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Personel güncelleme
app.put('/api/staff/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone } = req.body;
    const ownerId = req.user.userId;

    // Owner kontrolü
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel güncelleyebilir' });
    }

    // Personel bulma ve yetki kontrolü
    const staff = await User.findOne({
      _id: id,
      userType: 'staff',
      createdBy: ownerId
    });

    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    // E-posta kontrolü (başka kullanıcıda var mı)
    if (email && email !== staff.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: id } });
      if (existingUser) {
        return res.status(400).json({ error: 'Bu e-posta adresi ile zaten bir hesap var' });
      }
    }

    // Güncelleme
    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (phone) updateData.phone = phone;

    const updatedStaff = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      message: 'Personel başarıyla güncellendi',
      staff: updatedStaff
    });
  } catch (error) {
    console.error('Personel güncelleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Personel çalışma saatleri güncelleme
app.put('/api/staff/:id/working-hours', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { workingHours } = req.body;
    const ownerId = req.user.userId;

    // Owner kontrolü
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel çalışma saatlerini güncelleyebilir' });
    }

    // Personel bulma ve yetki kontrolü
    const staff = await User.findOne({
      _id: id,
      userType: 'staff',
      createdBy: ownerId
    });

    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    // Çalışma saatleri validasyonu
    if (!workingHours || typeof workingHours !== 'object') {
      return res.status(400).json({ error: 'Geçerli çalışma saatleri gerekli' });
    }

    // Güncelleme
    const updatedStaff = await User.findByIdAndUpdate(
      id,
      { workingHours },
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      message: 'Personel çalışma saatleri başarıyla güncellendi',
      staff: updatedStaff,
      workingHours: updatedStaff.workingHours
    });
  } catch (error) {
    console.error('Personel çalışma saatleri güncelleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Personel silme
app.delete('/api/staff/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;

    // Owner kontrolü
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel silebilir' });
    }

    // Personel bulma ve yetki kontrolü
    const staff = await User.findOne({
      _id: id,
      userType: 'staff',
      createdBy: ownerId
    });

    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    // Personeli sil
    await User.findByIdAndDelete(id);

    res.json({ message: 'Personel başarıyla silindi' });
  } catch (error) {
    console.error('Personel silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Avatar yükleme
app.post('/api/staff/:id/upload-avatar', authenticateToken, async (req, res) => {
  try {
    console.log('=== AVATAR UPLOAD DEBUG ===');
    console.log('Avatar upload başlatıldı:', { staffId: req.params.id, userId: req.user.userId });
    console.log('Request headers:', req.headers);
    console.log('Request content-type:', req.headers['content-type']);
    console.log('Request content-length:', req.headers['content-length']);
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request body type:', typeof req.body);
    console.log('Request body length:', JSON.stringify(req.body).length);
    console.log('Request body sample:', JSON.stringify(req.body).substring(0, 200));
    console.log('Raw body exists:', !!req.rawBody);
    
    const { id } = req.params;
    const { avatar } = req.body;
    const ownerId = req.user.userId;

    console.log('Avatar field exists:', !!avatar);
    console.log('Avatar type:', typeof avatar);
    
    if (!avatar) {
      console.log('HATA: Avatar verisi bulunamadı!');
      console.log('Tam req.body:', JSON.stringify(req.body, null, 2));
      console.log('Request body is empty or avatar field missing');
      return res.status(400).json({ error: 'Avatar verisi bulunamadı. Lütfen dosya seçtiğinizden emin olun.' });
    }

    // Base64 formatını kontrol et
    if (!avatar.startsWith('data:image/')) {
      console.log('Geçersiz avatar formatı:', avatar.substring(0, 50));
      return res.status(400).json({ error: 'Geçersiz avatar formatı' });
    }
    
    console.log('Avatar verisi alındı, format:', avatar.substring(0, 50));

    // Owner kontrolü
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri avatar yükleyebilir' });
    }

    // Personel bulma ve yetki kontrolü
    const staff = await User.findOne({
      _id: id,
      userType: 'staff',
      createdBy: ownerId
    });

    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    // Personelin avatar bilgisini güncelle (base64 formatında)
    await User.findByIdAndUpdate(id, { avatar: avatar });

    res.json({ 
      message: 'Avatar başarıyla yüklendi',
      avatar: avatar
    });
  } catch (error) {
    console.error('Avatar yükleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Avatar silme
app.delete('/api/staff/:id/avatar', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;

    // Owner kontrolü
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri avatar silebilir' });
    }

    // Personel bulma ve yetki kontrolü
    const staff = await User.findOne({
      _id: id,
      userType: 'staff',
      createdBy: ownerId
    });

    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    // Personelin avatar bilgisini temizle (veritabanından)
    await User.findByIdAndUpdate(id, { $unset: { avatar: 1 } });

    res.json({ message: 'Avatar başarıyla silindi' });
  } catch (error) {
    console.error('Avatar silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Belirli bir staff'ın hizmetlerini getir (owner için)
app.get('/api/services/staff/:staffId', authenticateToken, async (req, res) => {
  try {
    const { staffId } = req.params;
    const ownerId = req.user.userId;

    // Owner kontrolü
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri staff hizmetlerini görebilir' });
    }

    // Staff'ı bul ve yetki kontrolü yap
    const staff = await User.findOne({
      _id: staffId,
      userType: 'staff',
      createdBy: ownerId
    }).select('services name');

    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    const services = staff.services || [];
    
    res.json({ 
      success: true, 
      services,
      staffName: staff.name 
    });
  } catch (error) {
    console.error('Staff hizmetlerini getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Personele hizmet ekleme endpoint'i
app.post('/api/staff/:staffId/services', authenticateToken, async (req, res) => {
  try {
    const { staffId } = req.params;
    const { serviceData } = req.body;
    const ownerId = req.user.userId;

    // Owner kontrolü
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personele hizmet ekleyebilir' });
    }

    // Hizmet verisi kontrolü
    if (!serviceData || !serviceData.name) {
      return res.status(400).json({ error: 'Hizmet adı gereklidir' });
    }

    // Staff'ı bul ve yetki kontrolü yap
    const staff = await User.findOne({
      _id: staffId,
      userType: 'staff',
      createdBy: ownerId
    });

    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    const currentServices = staff.services || [];
    
    // Hizmet zaten var mı kontrol et
    const existingService = currentServices.find(s => 
      (typeof s === 'string' ? s : s.name) === serviceData.name.trim()
    );
    
    if (existingService) {
      return res.status(400).json({ error: 'Bu hizmet bu personel için zaten mevcut' });
    }

    // Yeni hizmet objesi oluştur
    const newService = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: serviceData.name.trim(),
      description: serviceData.description || '',
      duration: Number(serviceData.duration) || 0,
      price: Number(serviceData.price) || 0,
      images: serviceData.images || [],
      showInStore: serviceData.showInStore !== undefined ? serviceData.showInStore : true,
      createdAt: new Date()
    };

    // Yeni hizmeti personele ekle
    const updatedServices = [...currentServices, newService];
    
    await User.findByIdAndUpdate(
      staffId,
      { services: updatedServices },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Hizmet personele başarıyla eklendi',
      service: newService,
      services: updatedServices
    });
  } catch (error) {
    console.error('Personele hizmet ekleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Personelden hizmet silme endpoint'i
app.delete('/api/staff/:staffId/services/:serviceId', authenticateToken, async (req, res) => {
  try {
    const { staffId, serviceId } = req.params;
    const ownerId = req.user.userId;

    // Owner kontrolü
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel hizmetlerini silebilir' });
    }

    // Staff'ı bul ve yetki kontrolü yap
    const staff = await User.findOne({
      _id: staffId,
      userType: 'staff',
      createdBy: ownerId
    });

    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    const currentServices = staff.services || [];
    
    // Hizmeti bul ve sil
    const updatedServices = currentServices.filter(service => 
      (typeof service === 'string' ? service : service.id) !== serviceId
    );

    if (updatedServices.length === currentServices.length) {
      return res.status(404).json({ error: 'Silinecek hizmet bulunamadı' });
    }

    await User.findByIdAndUpdate(
      staffId,
      { services: updatedServices },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Hizmet personelden başarıyla silindi',
      services: updatedServices
    });
  } catch (error) {
    console.error('Personelden hizmet silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Services endpoints
// Hizmetleri getir
app.get('/api/services', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    // Owner için staffId parametresi varsa belirli personelin hizmetlerini getir
    const { staffId } = req.query;
    
    if (user.userType === 'owner' && staffId && staffId !== 'all') {
      // Belirli bir staff'ın hizmetlerini getir
      const staff = await User.findOne({
        _id: staffId,
        userType: 'staff',
        createdBy: user._id
      }).select('services name');
      
      if (!staff) {
        return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
      }
      
      const services = staff.services || [];
      
      // Hizmetleri standart formata dönüştür
      const formattedServices = services.map((service, index) => {
        if (typeof service === 'string') {
          return {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name: service,
            description: '',
            duration: 0,
            price: 0,
            images: [],
            createdAt: new Date()
          };
        }
        
        // Eğer service bir object ama name property'si yoksa, muhtemelen string'den yanlış parse edilmiş
        if (typeof service === 'object' && service !== null && !service.name) {
          // Object'in key'lerini kontrol et - eğer numeric key'ler varsa string'den yanlış parse edilmiş
          const keys = Object.keys(service).filter(key => !isNaN(key));
          
          if (keys.length > 0) {
            // Object'i tekrar string'e çevir
            const reconstructedString = keys.sort((a, b) => parseInt(a) - parseInt(b))
                                           .map(key => service[key])
                                           .join('');
            
            return {
              id: service._id || service.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
              name: reconstructedString,
              description: service.description || '',
              duration: parseInt(service.duration) || 0,
              price: parseFloat(service.price) || 0,
              images: service.images || [],
              createdAt: service.createdAt || new Date()
            };
          }
        }
        
        // Eğer service object'i doğru formatta ise olduğu gibi döndür
        if (typeof service === 'object' && service !== null && service.name) {
          return {
            id: service._id || service.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name: service.name,
            description: service.description || '',
            duration: service.duration !== undefined ? Number(service.duration) : 0,
            price: service.price !== undefined ? Number(service.price) : 0,
            images: service.images || [],
            showInStore: service.showInStore !== undefined ? service.showInStore : true,
            storeDescription: service.storeDescription || '',
            storeImages: service.storeImages || [],
            createdAt: service.createdAt || new Date()
          };
        }
        
        // Fallback: service'i string olarak kabul et
        return {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: String(service),
          description: '',
          duration: 0,
          price: 0,
          images: [],
          createdAt: new Date()
        };
      });
      
      return res.json({ services: formattedServices });
    }

    // Varsayılan: kullanıcının kendi hizmetlerini getir
    const userWithServices = await User.findById(req.user.userId).select('services');
    const services = userWithServices?.services || [];
    
    // Hizmetleri standart formata dönüştür
    const formattedServices = services.map((service, index) => {
      if (typeof service === 'string') {
        return {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: service,
          description: '',
          duration: 0,
          price: 0,
          images: [],
          createdAt: new Date()
        };
      }
      
      // Eğer service bir object ama name property'si yoksa, muhtemelen string'den yanlış parse edilmiş
      if (typeof service === 'object' && service !== null && !service.name) {
        // Object'in key'lerini kontrol et - eğer numeric key'ler varsa string'den yanlış parse edilmiş
        const keys = Object.keys(service).filter(key => !isNaN(key));
        
        if (keys.length > 0) {
          // Object'i tekrar string'e çevir
          const reconstructedString = keys.sort((a, b) => parseInt(a) - parseInt(b))
                                         .map(key => service[key])
                                         .join('');
          
          return {
            id: service._id || service.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name: reconstructedString,
            description: service.description || '',
            duration: service.duration !== undefined ? Number(service.duration) : 0,
            price: service.price !== undefined ? Number(service.price) : 0,
            images: service.images || [],
            createdAt: service.createdAt || new Date()
          };
        }
      }
      
      // Eğer service object'i doğru formatta ise - TÜM VERİLERİ KORU
      if (typeof service === 'object' && service !== null) {
        return {
          id: service._id || service.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: service.name || String(service),
          description: service.description || '',
          duration: service.duration !== undefined ? Number(service.duration) : 0,
          price: service.price !== undefined ? Number(service.price) : 0,
          images: service.images || [],
          showInStore: service.showInStore !== undefined ? service.showInStore : true,
          storeDescription: service.storeDescription || '',
          storeImages: service.storeImages || [],
          createdAt: service.createdAt || new Date()
        };
      }
      
      // Fallback: service'i string olarak kabul et
      return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        name: String(service),
        description: '',
        duration: 0,
        price: 0,
        images: [],
        createdAt: new Date()
      };
    });
    
    res.json({ services: formattedServices });
  } catch (error) {
    console.error('Hizmetleri getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Hizmetleri kaydet
app.post('/api/services', authenticateToken, async (req, res) => {
  try {
    const { services } = req.body;
    
    if (!Array.isArray(services)) {
      return res.status(400).json({ error: 'Hizmetler array formatında olmalıdır' });
    }

    // Hizmetleri object formatına dönüştür (eski string formatı desteklemek için)
    const formattedServices = services.map(service => {
      if (typeof service === 'string') {
        return {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: service.trim(),
          images: [],
          createdAt: new Date()
        };
      }
      return service;
    });

    // Kullanıcının hizmetlerini güncelle
    await User.findByIdAndUpdate(
      req.user.userId,
      { services: formattedServices },
      { new: true }
    );
    
    res.json({
      message: 'Hizmetler başarıyla kaydedildi',
      services: formattedServices
    });
  } catch (error) {
    console.error('Hizmetleri kaydetme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Tek hizmet ekleme endpoint'i
app.post('/api/services/add', authenticateToken, async (req, res) => {
  try {
    // Direkt formData veya service objesi kabul et
    const serviceData = req.body.service || req.body;
    
    if (!serviceData || !serviceData.name) {
      return res.status(400).json({ error: 'Hizmet adı gereklidir' });
    }
    
    const serviceName = serviceData.name.trim();
    
    if (!serviceName) {
      return res.status(400).json({ error: 'Hizmet adı gereklidir' });
    }

    // Kullanıcının mevcut hizmetlerini al
    const user = await User.findById(req.user.userId);
    const currentServices = user.services || [];
    
    // Hizmet zaten var mı kontrol et (isim bazında)
    const existingService = currentServices.find(s => 
      (typeof s === 'string' ? s : s.name) === serviceName
    );
    
    if (existingService) {
      return res.status(400).json({ error: 'Bu hizmet zaten mevcut' });
    }
    
    // Yeni hizmet objesi oluştur
    const newService = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: serviceName,
      description: serviceData.description || '',
      duration: Number(serviceData.duration) || 0,
      price: Number(serviceData.price) || 0,
      images: serviceData.images || [],
      showInStore: serviceData.showInStore !== undefined ? serviceData.showInStore : true,
      createdAt: new Date()
    };
    
    // Yeni hizmeti ekle
    const updatedServices = [...currentServices, newService];
    
    const updateResult = await User.findByIdAndUpdate(
      req.user.userId,
      { services: updatedServices },
      { new: true }
    );
    
    res.json({
      success: true,
      message: 'Hizmet başarıyla eklendi',
      service: newService,
      services: updatedServices
    });
  } catch (error) {
    console.error('Hizmet ekleme hatası:', error);
    res.status(500).json({ success: false, error: 'Sunucu hatası' });
  }
});

// Kullanıcıya özel hizmetleri getir
app.get('/api/services/user', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    // Kullanıcıya özel hizmetleri getir
    const userWithServices = await User.findById(req.user.userId).select('services');
    const services = userWithServices?.services || [];
    
    res.json({ success: true, services });
  } catch (error) {
    console.error('Kullanıcı hizmetlerini getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Hizmet güncelleme endpoint'i
app.put('/api/services/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, duration, price, showInStore, storeDescription, storeImages } = req.body;
    
    console.log('🔍 BACKEND: Hizmet güncelleme isteği');
    console.log('📋 Aranan ID:', id);
    
    const user = await User.findById(req.user.userId);
    const currentServices = user.services || [];
    
    console.log('📊 Mevcut hizmetler:', currentServices.map(s => ({
      type: typeof s,
      id: s.id,
      _id: s._id,
      name: s.name
    })));
    
    // Güncellenecek hizmeti bul
    console.log('🔍 BACKEND DEBUG: Aranan ID:', id);
    console.log('🔍 BACKEND DEBUG: ID tipi:', typeof id);
    console.log('🔍 BACKEND DEBUG: Mevcut services sayısı:', currentServices.length);
    
    currentServices.forEach((s, index) => {
      if (typeof s === 'object' && s !== null) {
        const serviceId = (s._id || s.id)?.toString();
        console.log(`🔍 Service ${index}: ID=${serviceId}, _id=${s._id}, id=${s.id}, name=${s.name}`);
      }
    });
    
    const serviceIndex = currentServices.findIndex(s => {
      if (typeof s === 'object' && s !== null) {
        // Frontend'e gönderilen ID ile aynı mantığı kullan: service._id || service.id
        const serviceId = (s._id || s.id)?.toString();
        console.log('🔍 Karşılaştırma:', serviceId, '===', id, '?', serviceId === id);
        return serviceId === id;
      }
      return s === id;
    });
    
    console.log('📍 Bulunan index:', serviceIndex);
    
    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }

    const currentService = currentServices[serviceIndex];

    // Eğer sadece store bilgileri güncelleniyorsa, name kontrolü yapma
    if (name && name.trim()) {
      // Aynı isimde başka hizmet var mı kontrol et (güncellenecek hizmet hariç)
      const existingService = currentServices.find((s, index) => 
        index !== serviceIndex && 
        (typeof s === 'string' ? s : s.name) === name.trim()
      );
      
      if (existingService) {
        return res.status(400).json({ error: 'Bu isimde bir hizmet zaten mevcut' });
      }
    }

    // Yalnızca gönderilen alanları ayarla (in-place update). Alt belge _id'sini koru.
    const updates = {};
    if (name !== undefined) updates.name = (name || '').trim();
    if (description !== undefined) updates.description = description;
    if (duration !== undefined) updates.duration = parseInt(duration) || 0;
    if (price !== undefined) updates.price = parseFloat(price) || 0;
    if (showInStore !== undefined) updates.showInStore = !!showInStore;
    if (storeDescription !== undefined) updates.storeDescription = storeDescription;
    if (storeImages !== undefined) updates.storeImages = storeImages;
    updates.updatedAt = new Date();

    const setPayload = {};
    Object.entries(updates).forEach(([k, v]) => {
      setPayload[`services.$.${k}`] = v;
    });

    // Eşleşme için _id varsa onu, yoksa custom id'yi kullan
    const matchByObjectId = (currentService && currentService._id) ? { 'services._id': currentService._id } : null;
    const matchByCustomId = (currentService && currentService.id) ? { 'services.id': currentService.id } : null;

    let modified = 0;
    if (matchByObjectId) {
      const res1 = await User.updateOne(
        { _id: req.user.userId, ...matchByObjectId },
        { $set: setPayload }
      );
      modified += res1.modifiedCount || res1.nModified || 0;
    }

    if (!modified && matchByCustomId) {
      const res2 = await User.updateOne(
        { _id: req.user.userId, ...matchByCustomId },
        { $set: setPayload }
      );
      modified += res2.modifiedCount || res2.nModified || 0;
    }

    if (!modified) {
      return res.status(404).json({ error: 'Hizmet güncellenemedi (eşleşme bulunamadı)' });
    }

    // Güncel kullanıcıyı tekrar al ve ilgili hizmeti döndür
    const freshUser = await User.findById(req.user.userId);
    const freshServices = freshUser?.services || [];
    const fresh = freshServices.find(s => ((s?._id || s?.id)?.toString?.() || s) === id);

    // Response servis objesini oluşturalım (id alanını _id ile hizala)
    const responseService = fresh ? {
      ...(typeof fresh === 'object' ? fresh.toObject?.() || fresh : { name: fresh || '', description: '', duration: 0, price: 0 }),
      id: (fresh?._id && fresh._id.toString) ? fresh._id.toString() : (fresh?.id || id)
    } : {
      ...currentService,
      ...updates,
      id: (currentService?._id && currentService._id.toString) ? currentService._id.toString() : (currentService?.id || id)
    };

    res.json({
      success: true,
      message: 'Hizmet başarıyla güncellendi',
      service: responseService,
      services: freshServices
    });
  } catch (error) {
    console.error('❌ BACKEND: Hizmet güncelleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Hizmet silme endpoint'i
app.delete('/api/services/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findById(req.user.userId);
    const currentServices = user.services || [];
    
    // Silinecek hizmeti bul
    const serviceIndex = currentServices.findIndex(s => {
      if (typeof s === 'object' && s !== null) {
        return s.id === id || s._id === id || s._id?.toString() === id;
      }
      return s === id;
    });
    
    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }
    
    // Hizmeti sil
    const deletedService = currentServices[serviceIndex];
    currentServices.splice(serviceIndex, 1);
    
    const updateResult = await User.findByIdAndUpdate(
      req.user.userId,
      { services: currentServices },
      { new: true }
    );
    
    res.json({
      message: 'Hizmet başarıyla silindi',
      deletedService: deletedService,
      services: currentServices
    });
  } catch (error) {
    console.error('Hizmet silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Hizmet görseli yükleme endpoint'i
// Hizmet görsellerini yükle (çoklu)
app.post('/api/services/:serviceId/upload-images', authenticateToken, async (req, res) => {
  try {
    if (!req.body.images || !Array.isArray(req.body.images) || req.body.images.length === 0) {
      return res.status(400).json({ error: 'En az bir görsel verisi gereklidir' });
    }

    const { serviceId } = req.params;
    if (!serviceId) {
      return res.status(400).json({ error: 'Hizmet ID gereklidir' });
    }

    // Kullanıcıyı bul
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    // Hizmeti bul - hem id hem _id ile kontrol et
    
    const serviceIndex = user.services.findIndex(service => 
      service.id == serviceId || service._id == serviceId || service._id.toString() == serviceId
    );
    
    
    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }

    // Hizmetin görsellerini güncelle (maksimum 5 görsel)
    if (!user.services[serviceIndex].images) {
      user.services[serviceIndex].images = [];
    }
    
    // Mevcut görselleri temizle ve yenilerini ekle
    user.services[serviceIndex].images = req.body.images.slice(0, 5); // Maksimum 5 görsel
    
    // Kullanıcıyı kaydet
    await user.save();
    
    res.json({
      success: true,
      message: 'Görseller başarıyla yüklendi',
      images: user.services[serviceIndex].images,
      service: user.services[serviceIndex]
    });
  } catch (error) {
    console.error('Görsel yükleme hatası:', error);
    // Hata durumunda yüklenen dosyaları sil
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

app.post('/api/services/upload-image', authenticateToken, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Görsel dosyası gereklidir' });
    }

    const { serviceId } = req.body;
    if (!serviceId) {
      return res.status(400).json({ error: 'Hizmet ID gereklidir' });
    }

    // Kullanıcıyı bul
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    // Hizmeti bul - hem id hem _id ile kontrol et
    
    const serviceIndex = user.services.findIndex(service => 
      service.id == serviceId || service._id == serviceId || service._id.toString() == serviceId
    );
    
    
    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }

    // Görsel URL'ini oluştur
    const imageUrl = `/uploads/${req.file.filename}`;
    
    // Hizmetin görsellerini güncelle (maksimum 5 görsel)
    if (!user.services[serviceIndex].images) {
      user.services[serviceIndex].images = [];
    }
    
    if (user.services[serviceIndex].images.length >= 5) {
      // Eski dosyayı sil
      const oldImagePath = path.join(__dirname, user.services[serviceIndex].images[0]);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
      // İlk görseli kaldır ve yenisini ekle
      user.services[serviceIndex].images.shift();
    }
    
    user.services[serviceIndex].images.push(imageUrl);
    
    // Kullanıcıyı kaydet
    await user.save();
    
    res.json({
      success: true,
      message: 'Görsel başarıyla yüklendi',
      imageUrl: imageUrl,
      service: user.services[serviceIndex]
    });
  } catch (error) {
    console.error('Görsel yükleme hatası:', error);
    // Hata durumunda yüklenen dosyayı sil
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Hizmet görseli silme endpoint'i
app.delete('/api/services/:serviceId/images/:imageIndex', authenticateToken, async (req, res) => {
  try {
    const { serviceId, imageIndex } = req.params;
    const index = parseInt(imageIndex);

    if (isNaN(index) || index < 0) {
      return res.status(400).json({ error: 'Geçersiz görsel indeksi' });
    }

    // Kullanıcıyı bul
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    // Hizmeti bul - hem id hem _id ile kontrol et
    
    const serviceIndex = user.services.findIndex(service => 
      service.id == serviceId || service._id == serviceId || service._id.toString() == serviceId
    );
    
    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }

    const service = user.services[serviceIndex];
    if (!service.images || index >= service.images.length) {
      return res.status(404).json({ error: 'Görsel bulunamadı' });
    }

    // Array'den görseli kaldır (base64 için dosya silme işlemi gerekmiyor)
    service.images.splice(index, 1);
    
    // Kullanıcıyı kaydet
    await user.save();
    
    res.json({
      success: true,
      message: 'Görsel başarıyla silindi',
      images: service.images
    });
  } catch (error) {
    console.error('Görsel silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Message Templates endpoints
// Mesaj şablonlarını getir
app.get('/api/message-templates', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    // Kullanıcıya özel mesaj şablonlarını getir
    const userWithTemplates = await User.findById(req.user.userId).select('messageTemplates');
    const templates = userWithTemplates?.messageTemplates || [];
    
    res.json({ success: true, templates });
  } catch (error) {
    console.error('Mesaj şablonlarını getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mesaj şablonlarını kaydet
app.post('/api/message-templates', authenticateToken, async (req, res) => {
  try {
    const { templates } = req.body;
    
    if (!Array.isArray(templates)) {
      return res.status(400).json({ error: 'Şablonlar array formatında olmalıdır' });
    }

    // Kullanıcının mesaj şablonlarını güncelle
    await User.findByIdAndUpdate(
      req.user.userId,
      { messageTemplates: templates },
      { new: true }
    );
    
    res.json({
      success: true,
      message: 'Mesaj şablonları başarıyla kaydedildi',
      templates
    });
  } catch (error) {
    console.error('Mesaj şablonlarını kaydetme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Customers endpoints
// Müşterileri getir
app.get('/api/customers', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    let customers = [];
    const { staffId } = req.query;

    if (user.userType === 'owner') {
      // Owner için staffId parametresi varsa belirli personelin müşterilerini getir
      if (staffId && staffId !== 'all') {
        // Belirli bir staff'ın müşterilerini getir
        const staff = await User.findOne({
          _id: staffId,
          userType: 'staff',
          createdBy: user._id
        }).select('customers name');
        
        if (!staff) {
          return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
        }
        
        customers = staff.customers || [];
      } else {
        // Tüm müşteriler: kendi müşterileri + staff'ların eklediği müşteriler
        const ownerCustomers = user.customers || [];
        
        // Aynı işletmedeki staff'ları bul
        const staffMembers = await User.find({
          userType: 'staff',
          businessId: user._id
        }).select('customers');
        
        // Tüm staff müşterilerini topla
        const allStaffCustomers = [];
        staffMembers.forEach(staff => {
          if (staff.customers && staff.customers.length > 0) {
            allStaffCustomers.push(...staff.customers);
          }
        });
        
        // Müşterileri birleştir ve duplikatları kaldır
        const allCustomers = [...ownerCustomers, ...allStaffCustomers];
        const uniqueCustomers = allCustomers.filter((customer, index, self) => 
          index === self.findIndex(c => c.phone === customer.phone || c.name === customer.name)
        );
        
        customers = uniqueCustomers;
      }
    } else {
      // Staff ise: sadece kendi müşterileri
      customers = user.customers || [];
      
      // Staff için müşteri istatistiklerini hesapla (randevu sayısı, son ziyaret)
      for (let customer of customers) {
        // Bu müşterinin bu staff ile olan randevularını bul
        // Daha esnek eşleştirme: isim veya telefon ile
        const nameQuery = customer.name ? { clientName: { $regex: new RegExp(customer.name, 'i') } } : null;
        const phoneQuery = customer.phone ? { clientPhone: customer.phone } : null;
        
        let matchQuery = [];
        if (nameQuery) matchQuery.push(nameQuery);
        if (phoneQuery) matchQuery.push(phoneQuery);
        
        if (matchQuery.length === 0) {
          customer.totalAppointments = 0;
          customer.lastVisit = null;
          continue;
        }
        
        const customerAppointments = await Appointment.find({
          businessId: user.businessId,
          createdBy: user._id,
          $or: matchQuery
        }).sort({ date: -1, startTime: -1 });
        
        
        customer.totalAppointments = customerAppointments.length;
        customer.lastVisit = customerAppointments.length > 0 ? customerAppointments[0].date : null;
        
      }
    }
    
    res.json({ customers });
  } catch (error) {
    console.error('Müşterileri getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Müşterileri kaydet
app.post('/api/customers', authenticateToken, async (req, res) => {
  try {
    const { customers } = req.body;
    
    if (!Array.isArray(customers)) {
      return res.status(400).json({ error: 'Müşteriler array formatında olmalıdır' });
    }

    // Kullanıcının müşterilerini güncelle
    await User.findByIdAndUpdate(
      req.user.userId,
      { customers: customers },
      { new: true }
    );
    
    res.json({
      message: 'Müşteriler başarıyla kaydedildi',
      customers
    });
  } catch (error) {
    console.error('Müşterileri kaydetme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Tek müşteri ekleme
app.post('/api/customers/add', authenticateToken, async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({ error: 'Müşteri adı ve telefonu gereklidir' });
    }

    // Kullanıcı bilgilerini al
    const currentUser = await User.findById(req.user.userId).select('customers businessId userType');
    const customers = currentUser?.customers || [];
    
    // Aynı müşteri var mı kontrol et
    const existingCustomer = customers.find(c => 
      c.name.toLowerCase() === name.toLowerCase() ||
      (phone && c.phone === phone)
    );
    
    if (existingCustomer) {
      return res.status(400).json({ error: 'Bu müşteri zaten mevcut' });
    }
    
    // BusinessId doğrulama ve düzeltme
    let effectiveBusinessId = currentUser.businessId;
    if (!effectiveBusinessId) {
      if (currentUser.userType === 'owner') {
        const biz = await Business.findOne({ ownerId: currentUser._id });
        if (biz) {
          effectiveBusinessId = biz._id;
          try { await User.findByIdAndUpdate(currentUser._id, { businessId: biz._id }); } catch (e) { console.error('Owner businessId düzeltme hatası:', e); }
        }
      }
    }

    const newCustomer = {
      id: Date.now().toString(),
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim() : '',
      addedBy: req.user.userId,
      businessId: effectiveBusinessId,
      createdAt: new Date().toISOString()
    };
    
    const updatedCustomers = [...customers, newCustomer];
    
    // Müşteriyi ekleyen kullanıcının müşteri listesine ekle
    await User.findByIdAndUpdate(
      req.user.userId,
      { customers: updatedCustomers },
      { new: true }
    );
    
    // Eğer staff ise, owner'ın müşteri listesine de ekle
    if (currentUser.userType === 'staff' && currentUser.businessId) {
      const biz = await Business.findById(currentUser.businessId).select('ownerId');
      const ownerId = biz?.ownerId;
      const owner = ownerId ? await User.findById(ownerId).select('customers') : null;
      const ownerCustomers = owner?.customers || [];
      
      // Owner'da aynı müşteri var mı kontrol et
      const existingInOwner = ownerCustomers.find(c => 
        c.name.toLowerCase() === name.toLowerCase() ||
        (phone && c.phone === phone)
      );
      
      if (!existingInOwner) {
        const ownerUpdatedCustomers = [...ownerCustomers, newCustomer];
        if (ownerId) {
          await User.findByIdAndUpdate(
            ownerId,
            { customers: ownerUpdatedCustomers },
            { new: true }
          );
        }
      }
    }
    
    res.json({
      message: 'Müşteri başarıyla eklendi',
      customer: newCustomer,
      customers: updatedCustomers
    });
  } catch (error) {
    console.error('Müşteri ekleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Müşteri güncelleme
app.put('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({ error: 'Müşteri adı ve telefonu gereklidir' });
    }

    const user = await User.findById(req.user.userId).select('customers');
    const customers = user?.customers || [];
    
    // Müşteriyi bul (id veya _id ile)
    const customerIndex = customers.findIndex(c => 
      c.id === id || c._id === id || (c._id?.toString && c._id?.toString() === id)
    );
    if (customerIndex === -1) {
      return res.status(404).json({ error: 'Müşteri bulunamadı' });
    }
    
    // Aynı isim/telefon ile başka müşteri var mı kontrol et
    const existingCustomer = customers.find((c, index) => 
      index !== customerIndex && (
        c.name.toLowerCase() === name.toLowerCase() ||
        (phone && c.phone === phone)
      )
    );
    
    if (existingCustomer) {
      return res.status(400).json({ error: 'Bu isim veya telefon numarası başka bir müşteri tarafından kullanılıyor' });
    }
    
    // Müşteriyi güncelle
    customers[customerIndex] = {
      ...customers[customerIndex],
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim() : '',
      updatedAt: new Date().toISOString()
    };
    
    await User.findByIdAndUpdate(
      req.user.userId,
      { customers: customers },
      { new: true }
    );
    
    res.json({
      message: 'Müşteri başarıyla güncellendi',
      customer: customers[customerIndex],
      customers: customers
    });
  } catch (error) {
    console.error('Müşteri güncelleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Müşteri silme
app.delete('/api/customers/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(req.user.userId).select('customers');
    const customers = user?.customers || [];
    
    // Müşteriyi bul (id veya _id ile)
    const customerIndex = customers.findIndex(c => 
      c.id === id || c._id === id || (c._id?.toString && c._id?.toString() === id)
    );
    if (customerIndex === -1) {
      return res.status(404).json({ error: 'Müşteri bulunamadı' });
    }
    
    // Müşteriyi sil
    const deletedCustomer = customers.splice(customerIndex, 1)[0];
    
    await User.findByIdAndUpdate(
      req.user.userId,
      { customers: customers },
      { new: true }
    );
    
    res.json({
      message: 'Müşteri başarıyla silindi',
      deletedCustomer: deletedCustomer,
      customers: customers
    });
  } catch (error) {
    console.error('Müşteri silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});





// Mağaza ayarlarını getir
app.get('/api/store/settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    if (!user || user.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri bu işlemi yapabilir' });
    }

    const storeSettings = user.storeSettings || {
      enabled: false,
      storeName: '',
      storeDescription: '',
      showServiceDurations: true,
      allowStaffSelection: true,
      allowAppointmentCancellation: true,
      notificationPhone: '',
      showPlanlyoLogo: true,
      enableChatAssistant: false,
      updatedAt: new Date()
    };

    res.json(storeSettings);
  } catch (error) {
    console.error('Mağaza ayarları getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mağaza ayarlarını kaydet
app.put('/api/store/settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    
    if (!user || user.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri bu işlemi yapabilir' });
    }

    const { 
      enabled, 
      storeName, 
      storeDescription,
      showServiceDurations,
      allowStaffSelection,
      allowAppointmentCancellation,
      notificationPhone,
      showPlanlyoLogo,
      enableChatAssistant
    } = req.body;

    // Mağaza adı validasyonu - artık mağaza etkinleştirildiğinde zorunlu değil
    // Kullanıcı önce mağazayı etkinleştirebilir, sonra adını belirleyebilir

    // Mağaza adı benzersizlik kontrolü (eğer etkinleştirilmişse)
    if (enabled && storeName) {
      const existingStore = await User.findOne({
        'storeSettings.enabled': true,
        'storeSettings.storeName': storeName.trim(),
        _id: { $ne: user._id }
      });

      if (existingStore) {
        return res.status(400).json({ error: 'Bu mağaza adı zaten kullanılıyor' });
      }
    }

    // Ayarları güncelle
    user.storeSettings = {
      enabled: enabled || false,
      storeName: storeName ? storeName.trim() : '',
      storeDescription: storeDescription || '',
      showServiceDurations: showServiceDurations !== undefined ? showServiceDurations : true,
      allowStaffSelection: allowStaffSelection !== undefined ? allowStaffSelection : true,
      allowAppointmentCancellation: allowAppointmentCancellation !== undefined ? allowAppointmentCancellation : true,
      notificationPhone: notificationPhone || '',
      showPlanlyoLogo: showPlanlyoLogo !== undefined ? showPlanlyoLogo : true,
      enableChatAssistant: enableChatAssistant !== undefined ? enableChatAssistant : false,
      updatedAt: new Date()
    };

    await user.save();

    res.json({
      message: 'Mağaza ayarları başarıyla güncellendi',
      storeSettings: user.storeSettings
    });
  } catch (error) {
    console.error('Mağaza ayarları kaydetme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Public mağaza verilerini getir (storeName ile)
app.get('/api/public/store/:storeName', async (req, res) => {
  try {
    const { storeName } = req.params;
    
    if (!storeName) {
      return res.status(400).json({ error: 'Mağaza adı gerekli' });
    }

    // Aktif mağazayı bul
    const user = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    });

    if (!user || !user.storeSettings || !user.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    // İşletme bilgilerini ayrıca getir
    const business = await Business.findOne({ ownerId: user._id });

    // Public store bilgilerini döndür
    const storeData = {
      storeName: user.storeSettings.storeName,
      storeDescription: user.storeSettings.storeDescription,
      enabled: user.storeSettings.enabled,
      showServiceDurations: user.storeSettings.showServiceDurations,
      allowStaffSelection: user.storeSettings.allowStaffSelection,
      allowAppointmentCancellation: user.storeSettings.allowAppointmentCancellation,
      showPlanlyoLogo: user.storeSettings.showPlanlyoLogo,
      enableChatAssistant: user.storeSettings.enableChatAssistant,
      // Sadece mağazada gösterilecek hizmetleri filtrele ve tüm alanları dahil et
      services: (user.services || []).filter(service => {
        if (typeof service === 'string') return true; // Eski format için
        return service.showInStore !== false; // showInStore false değilse göster
      }).map(service => {
        // Hizmet objesi ise tüm alanları dahil et, string ise olduğu gibi bırak
        if (typeof service === 'object' && service !== null) {
          return {
            id: service.id || service._id,
            name: service.name,
            description: service.description,
            duration: service.duration,
            price: service.price,
            images: service.images || [], // Resimleri dahil et
            storeImages: service.storeImages || [], // Store özel resimler varsa onları da dahil et
            storeDescription: service.storeDescription,
            showInStore: service.showInStore,
            createdAt: service.createdAt
          };
        }
        return service;
      }),
      business: business ? {
        name: business.name,
        description: business.description,
        address: business.address,
        phone: business.phone,
        email: business.email,
        website: business.website,
        logo: business.logo,
        services: business.services,
        staff: business.staff,
        workingHours: business.workingHours
      } : null
    };

    res.json(storeData);
  } catch (error) {
    console.error('Public mağaza verilerini getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Public randevu oluşturma endpoint'i (mağaza sayfası için)
app.post('/api/public/store/:storeName/appointments', async (req, res) => {
  try {
    const { storeName } = req.params;
    const { 
      customerName, 
      customerPhone, 
      customerEmail, 
      serviceId, 
      staffId, 
      date, 
      time 
    } = req.body;

    // Gerekli alanları kontrol et
    if (!storeName || !customerName || !customerPhone || !serviceId || !date || !time) {
      return res.status(400).json({ 
        error: 'Mağaza adı, müşteri adı, telefon, hizmet, tarih ve saat gerekli' 
      });
    }

    // Mağaza sahibini bul
    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    }).populate('businessId');

    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    // Deneme süresi kontrolü: deneme bittiyse ve premium değilse randevu alma kapalı (fail-closed)
    const now = new Date();
    const TRIAL_DAYS = 7;
    const trialStartLocal = storeOwner.createdAt || new Date(0);
    const trialEndsAtLocal = new Date(trialStartLocal.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    if (!storeOwner.isPremium && now >= trialEndsAtLocal) {
      return res.status(403).json({ error: 'Mağaza için deneme süresi sona erdi. Paket satın alınmadan randevu alınamaz.' });
    }

    // Üyelik süresi kontrolü: üyelik bitti ise randevu alma kapalı
    try {
      const membershipEndsAtLocal = storeOwner.membershipEndsAt ? new Date(storeOwner.membershipEndsAt) : null;
      const membershipExpiredLocal = !!(membershipEndsAtLocal && now >= membershipEndsAtLocal);
      if (membershipExpiredLocal) {
        return res.status(403).json({ error: 'Mağaza üyeliği sona erdi. Paket yenilenmeden randevu alınamaz.' });
      }
    } catch (expErr) {
      console.warn('Public membership expiry kontrol hatası:', expErr);
    }

    // Kota enforcement: aylık kota dolmuşsa randevu alma kapalı
    try {
      const planQuotaMap = { plus: 200, pro: 400, premium: null };
      const effectiveMonthlyQuota = planQuotaMap[storeOwner.planType] ?? storeOwner.monthlyQuota ?? null;
      if (storeOwner.isPremium && effectiveMonthlyQuota != null) {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const usedCountThisMonth = await Appointment.countDocuments({
          businessId: storeOwner.businessId._id,
          isBlocked: false,
          status: { $ne: 'cancelled' },
          $or: [
            { createdAt: { $gte: startOfMonth, $lte: endOfMonth } },
            { $and: [
              { createdAt: { $exists: false } },
              { date: { $gte: startOfMonth, $lte: endOfMonth } }
            ] }
          ]
        });
        if (usedCountThisMonth >= effectiveMonthlyQuota) {
          return res.status(403).json({ error: 'Aylık randevu hakkı doldu. Yeni dönem başlayınca tekrar deneyin.' });
        }
      }
    } catch (quotaErr) {
      console.warn('Public kota kontrol hatası:', quotaErr);
    }

    // Hizmeti kontrol et
    const service = storeOwner.services.find(s => 
      (s.id || s._id).toString() === serviceId
    );
    
    if (!service) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }

    // Personeli kontrol et (eğer belirtilmişse)
    let selectedStaff = null;
    if (staffId && storeOwner.businessId && storeOwner.businessId.staff) {
      selectedStaff = storeOwner.businessId.staff.find(s => 
        s._id.toString() === staffId
      );
      if (!selectedStaff) {
        return res.status(404).json({ error: 'Personel bulunamadı' });
      }
    }

    // Müşteriyi bul veya oluştur
    let customer = await User.findOne({ 
      phone: customerPhone,
      businessId: storeOwner.businessId._id 
    });

    if (!customer) {
      // Yeni müşteri oluştur
      customer = new User({
        name: customerName,
        phone: customerPhone,
        email: customerEmail || '',
        role: 'customer',
        businessId: storeOwner.businessId._id,
        password: 'default-password'
      });
      await customer.save();
    }

    // Randevu oluştur
    const appointment = new Appointment({
      customerId: customer._id,
      businessId: storeOwner.businessId._id,
      service: service.name,
      serviceId: serviceId,
      staffId: selectedStaff ? selectedStaff._id : null,
      staffName: selectedStaff ? selectedStaff.name : 'Belirtilmedi',
      date: new Date(date),
      time: time,
      status: 'scheduled',
      notes: `Mağaza sayfasından oluşturulan randevu - ${storeName}`,
      createdBy: storeOwner._id,
      duration: service.duration || 60
    });

    await appointment.save();

    // Sayaç artırma: premium ve kota sınırlı ise basit sayaç artışı
    try {
      const planQuotaMapInc = { plus: 200, pro: 400, premium: null };
      const effectiveMonthlyQuotaInc = planQuotaMapInc[storeOwner.planType] ?? storeOwner.monthlyQuota ?? null;
      const shouldIncrement = !!storeOwner.isPremium && effectiveMonthlyQuotaInc != null;
      if (shouldIncrement) {
        await User.findByIdAndUpdate(storeOwner._id, { $inc: { usedAppointmentsThisMonth: 1 }, lastResetAt: storeOwner.lastResetAt || new Date() });
      }
    } catch (incErr) {
      console.warn('Public aylık kullanım sayaç artırma hatası:', incErr);
    }

    res.status(201).json({
      message: 'Randevu başarıyla oluşturuldu',
      appointment: {
        id: appointment._id,
        service: appointment.service,
        staffName: appointment.staffName,
        date: appointment.date,
        time: appointment.time,
        status: appointment.status
      }
    });

  } catch (error) {
    console.error('Public randevu oluşturma hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mağaza için müsait saatleri getir (public endpoint)
app.get('/api/public/store/:storeName/available-slots', async (req, res) => {
  try {
    const { storeName } = req.params;
    const { date, serviceId, staffId } = req.query;

    if (!storeName || !date || !serviceId) {
      return res.status(400).json({ 
        error: 'Mağaza adı, tarih ve hizmet ID gerekli' 
      });
    }

    // Mağaza sahibini bul
    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    }).populate('businessId');

    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    // İşletme bilgisi mevcut mu kontrol et
    if (!storeOwner.businessId) {
      return res.status(400).json({ error: 'İşletme bilgisi bulunamadı' });
    }

    // Hizmeti bul (string veya object olabilir)
    const service = storeOwner.services.find(s => {
      const sid = (typeof s === 'object' && s !== null) ? (s.id || s._id) : s;
      return sid && sid.toString() === serviceId;
    });
    
    if (!service) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }

    // O tarih için mevcut randevuları getir
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const existingAppointments = await Appointment.find({
      businessId: storeOwner.businessId._id,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: 'cancelled' },
      ...(staffId && { staffId: staffId })
    });

    // Çalışma saatlerini al - sadece kullanıcının tanımladığı saatler
    const workingHours = storeOwner.businessId.workingHours;

    // Çalışma saatleri tanımlanmamışsa boş slot döndür
    if (!workingHours) {
      return res.json({ availableSlots: [] });
    }

    // Gün adını al
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[new Date(date).getDay()];
    const daySchedule = workingHours[dayName];

    if (!daySchedule || !daySchedule.enabled) {
      return res.json({ availableSlots: [] });
    }

    // Müsait saatleri hesapla
    const serviceDuration = (typeof service === 'object' && service !== null) ? (service.duration || 60) : 60;
    const availableSlots = [];
    
    const [startHour, startMinute] = daySchedule.start.split(':').map(Number);
    const [endHour, endMinute] = daySchedule.end.split(':').map(Number);
    
    let currentTime = startHour * 60 + startMinute; // dakika cinsinden
    const endTime = endHour * 60 + endMinute;

    while (currentTime + serviceDuration <= endTime) {
      const hour = Math.floor(currentTime / 60);
      const minute = currentTime % 60;
      const timeSlot = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
      
      // Bu saatte randevu var mı kontrol et
      const isBooked = existingAppointments.some(apt => apt.time === timeSlot);
      
      if (!isBooked) {
        availableSlots.push(timeSlot);
      }
      
      currentTime += 30; // 30 dakika aralıklarla
    }

    res.json({ availableSlots });

  } catch (error) {
    console.error('Müsait saatleri getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mağaza personellerini getir (public endpoint)
app.get('/api/public/store/:storeName/staff', async (req, res) => {
  try {
    const { storeName } = req.params;

    if (!storeName) {
      return res.status(400).json({ error: 'Mağaza adı gerekli' });
    }

    // Mağaza sahibini bul
    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    }).populate('businessId');

    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    // Personel listesini döndür
    const staff = storeOwner.businessId && storeOwner.businessId.staff ? 
      storeOwner.businessId.staff.map(member => ({
        id: member._id,
        name: member.name,
        specialties: member.specialties || []
      })) : [];

    res.json({ staff });

  } catch (error) {
    console.error('Personel listesini getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mağaza randevularını getir (public endpoint - takvim görünümü için)
app.get('/api/public/store/:storeName/appointments', async (req, res) => {
  try {
    const { storeName } = req.params;
    const { staffId, startDate, endDate } = req.query;

    if (!storeName) {
      return res.status(400).json({ error: 'Mağaza adı gerekli' });
    }

    // Mağaza sahibini bul
    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    });

    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    // BusinessId kontrolü
    if (!storeOwner.businessId) {
      return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    }

    // Tarih aralığını belirle (varsayılan olarak bugünden 30 gün sonraya kadar)
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Query oluştur
    let query = {
      businessId: storeOwner.businessId,
      date: { $gte: start, $lte: end },
      status: { $ne: 'cancelled' }
    };

    // Belirli bir personel için filtreleme
    if (staffId && staffId !== 'all') {
      query.staffId = staffId;
    }

    // Randevuları getir
    const appointments = await Appointment.find(query)
      .sort({ date: 1, time: 1 });

    // Sadece gerekli bilgileri döndür (müşteri gizliliği için)
    const publicAppointments = appointments.map(apt => ({
      id: apt._id,
      date: apt.date,
      time: apt.time,
      duration: apt.duration || 60,
      service: apt.service,
      staffId: apt.staffId || null,
      staffName: apt.staffName || 'Belirtilmedi',
      status: apt.status,
      // Müşteri bilgilerini gizle, sadece dolu olduğunu göster
      isBooked: true
    }));

    res.json({ appointments: publicAppointments });

  } catch (error) {
    console.error('Mağaza randevularını getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mağaza çalışma saatlerini getir (public endpoint)
app.get('/api/public/store/:storeName/working-hours', async (req, res) => {
  try {
    const { storeName } = req.params;
    const { staffId, serviceId } = req.query;

    if (!storeName) {
      return res.status(400).json({ error: 'Mağaza adı gerekli' });
    }

    // Mağaza sahibini bul
    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    });

    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    // BusinessId kontrolü: Business._id olmalı, gerektiğinde düzelt
    let business = null;
    if (!storeOwner.businessId) {
      business = await Business.findOne({ ownerId: storeOwner._id });
      if (business) {
        try {
          await User.findByIdAndUpdate(storeOwner._id, { businessId: business._id });
        } catch (e) {
          console.error('Public working-hours owner businessId güncelleme hatası:', e);
        }
      } else {
        return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
      }
    } else {
      business = await Business.findById(storeOwner.businessId);
      if (!business) {
        const fallbackBiz = await Business.findOne({ ownerId: storeOwner._id });
        if (fallbackBiz) {
          business = fallbackBiz;
          try { await User.findByIdAndUpdate(storeOwner._id, { businessId: fallbackBiz._id }); } catch (e) { console.error('Public working-hours düzeltme hatası:', e); }
        } else {
          return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
        }
      }
    }
    
    let workingHours = null;
    let serviceCreatorId = null;

    // Eğer serviceId verilmişse, o hizmeti oluşturan personeli bul
    if (serviceId) {
      // Önce store owner'ın hizmetlerinde ara
      if (storeOwner.services && Array.isArray(storeOwner.services)) {
        const ownerService = storeOwner.services.find(service => {
          if (typeof service === 'object' && service !== null) {
            return service.id === serviceId || service._id === serviceId;
          }
          return false;
        });
        
        if (ownerService) {
          serviceCreatorId = storeOwner._id;
        }
      }

      // Eğer owner'da bulunamadıysa, personellerin hizmetlerinde ara
      if (!serviceCreatorId && business && business.staff) {
        for (const staff of business.staff) {
          if (staff.services && Array.isArray(staff.services)) {
            const staffService = staff.services.find(service => {
              if (typeof service === 'object' && service !== null) {
                return service.id === serviceId || service._id === serviceId;
              }
              return false;
            });
            
            if (staffService) {
              serviceCreatorId = staff._id;
              break;
            }
          }
        }
      }
    }

    // Çalışma saatlerini belirle
    if (serviceCreatorId) {
      // Hizmet oluşturan kişinin çalışma saatlerini kullan
      if (serviceCreatorId.toString() === storeOwner._id.toString()) {
        // Store owner'ın çalışma saatleri
        if (storeOwner.workingHours && typeof storeOwner.workingHours === 'object') {
          workingHours = storeOwner.workingHours;
        }
      } else {
        // Personelin çalışma saatleri
        const staff = business && business.staff ? 
          business.staff.find(s => s._id.toString() === serviceCreatorId.toString()) : null;
        
        if (staff && staff.workingHours && typeof staff.workingHours === 'object') {
          workingHours = staff.workingHours;
        }
      }
    } else if (staffId && staffId !== 'all') {
      // Belirli bir personelin çalışma saatleri (eski davranış)
      const staff = business && business.staff ? 
        business.staff.find(s => s._id.toString() === staffId) : null;
      
      if (staff && staff.workingHours && typeof staff.workingHours === 'object') {
        workingHours = staff.workingHours;
      } else if (storeOwner.workingHours && typeof storeOwner.workingHours === 'object') {
        workingHours = storeOwner.workingHours;
      } else if (business && business.workingHours && typeof business.workingHours === 'object') {
        workingHours = business.workingHours;
      }
    } else {
      // Genel çalışma saatleri için öncelik sırası: User -> Business
      if (storeOwner.workingHours && typeof storeOwner.workingHours === 'object') {
        workingHours = storeOwner.workingHours;
      } else if (business && business.workingHours && typeof business.workingHours === 'object') {
        workingHours = business.workingHours;
      }
    }

    // Eğer hiç çalışma saati bulunamadıysa boş obje döndür
    if (!workingHours) {
      workingHours = {};
    }

    res.json({ workingHours, serviceCreatorId });

  } catch (error) {
    console.error('Mağaza çalışma saatlerini getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Randevu talebi endpoint'i - Basit form için
app.post('/api/public/store/:storeName/appointment-request', async (req, res) => {
  console.log('Appointment request endpoint hit:', req.params, req.body);
  try {
    const { storeName } = req.params;
    const { firstName, lastName, phone, serviceName, serviceId } = req.body;

    // Form validasyonu
    console.log('Form validation check:', { firstName, lastName, phone });
    if (!firstName || !lastName || !phone) {
      console.log('Form validation failed');
      return res.status(400).json({ error: 'Ad, soyad ve telefon alanları zorunludur.' });
    }

    // Mağaza sahibini bul
    console.log('Looking for store owner:', storeName);
    
    const storeOwner = await User.findOne({ 
      'storeSettings.storeName': { $regex: new RegExp(`^${storeName}$`, 'i') } 
    });
    console.log('Store owner found:', storeOwner ? 'Yes' : 'No');

    if (!storeOwner) {
      console.log('Store owner not found');
      return res.status(404).json({ error: 'Mağaza bulunamadı' });
    }

    // Randevu talebi verilerini hazırla
    const appointmentRequestData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      serviceName: serviceName || 'Genel Randevu',
      storeName: storeName,
      storeOwnerId: storeOwner._id,
      status: 'pending',
      notes: `Randevu talebi - ${firstName} ${lastName} (${phone}) - ${serviceName || 'Genel Randevu'}`
    };

    // ServiceId varsa ve geçerli ObjectId ise ekle
    if (serviceId && mongoose.Types.ObjectId.isValid(serviceId)) {
      appointmentRequestData.serviceId = serviceId;
    }

    // Randevu talebi oluştur
    const appointmentRequest = new AppointmentRequest(appointmentRequestData);
    await appointmentRequest.save();

    console.log('Randevu talebi oluşturuldu:', {
      id: appointmentRequest._id,
      customer: `${firstName} ${lastName}`,
      phone: phone,
      service: serviceName,
      store: storeName
    });

    res.status(201).json({ 
      message: 'Randevu talebiniz başarıyla alındı. En kısa sürede sizinle iletişime geçeceğiz.',
      requestId: appointmentRequest._id
    });

  } catch (error) {
    console.error('Randevu talebi oluşturma hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Geocoding proxy endpoint - CORS sorununu çözmek için
app.get('/api/geocode', async (req, res) => {
  try {
    const { address } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Adres parametresi gerekli' });
    }

    // Nominatim API'sını backend'den çağır
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=tr&limit=1&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'PlanApp/1.0 (contact@planapp.com)'
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      res.json(data);
    } else {
      res.status(response.status).json({ error: 'Geocoding API hatası' });
    }
  } catch (error) {
    console.error('Geocoding proxy hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// İletişim mesajı oluştur (public endpoint)
app.post('/api/contact-messages', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !message) {
      return res.status(400).json({ error: 'Ad ve mesaj zorunludur' });
    }

    const contactMessage = new ContactMessage({
      name: (name || '').trim(),
      email: (email || '').trim(),
      phone: (phone || '').trim(),
      message: (message || '').trim(),
    });

    await contactMessage.save();

    res.status(201).json({ success: true, message: 'Mesajınız alındı', id: contactMessage._id });
  } catch (error) {
    console.error('İletişim mesajı kaydetme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Yeni randevu talebi oluştur
app.post('/api/appointment-requests', async (req, res) => {
  try {
    const { firstName, lastName, phone, serviceName, storeName, notes } = req.body;
    
    if (!firstName || !lastName || !phone) {
      return res.status(400).json({ error: 'Ad, soyad ve telefon alanları zorunludur' });
    }

    // Store name'e göre business'ı bul
    const business = await Business.findOne({ name: storeName });
    if (!business) {
      return res.status(404).json({ error: 'İşletme bulunamadı' });
    }

    const appointmentRequest = new AppointmentRequest({
      firstName,
      lastName,
      phone,
      serviceName: serviceName || '',
      storeName,
      storeOwnerId: business.ownerId,
      notes: notes || '',
      status: 'pending'
    });

    await appointmentRequest.save();
    
    console.log('Yeni randevu talebi oluşturuldu:', appointmentRequest);
    
    res.status(201).json({
      success: true,
      message: 'Randevu talebiniz başarıyla gönderildi',
      appointmentRequest
    });

  } catch (error) {
    console.error('Randevu talebi oluşturma hatası:', error);
    res.status(500).json({ 
      error: 'Randevu talebi oluşturulurken bir hata oluştu',
      details: error.message 
    });
  }
});

// Randevu talebinin durumunu güncelle
app.put('/api/appointment-requests/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ error: 'Geçersiz randevu talebi ID' });
    }

    if (!status) {
      return res.status(400).json({ error: 'Durum bilgisi gereklidir' });
    }

    const validStatuses = ['pending', 'contacted', 'scheduled', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Geçersiz durum değeri' });
    }

    const appointmentRequest = await AppointmentRequest.findByIdAndUpdate(
      requestId,
      { status },
      { new: true }
    );

    if (!appointmentRequest) {
      return res.status(404).json({ error: 'Randevu talebi bulunamadı' });
    }

    console.log('Randevu talebi durumu güncellendi:', appointmentRequest);

    res.status(200).json({
      success: true,
      message: 'Durum başarıyla güncellendi',
      appointmentRequest
    });

  } catch (error) {
    console.error('Randevu talebi durum güncelleme hatası:', error);
    res.status(500).json({ 
      error: 'Durum güncellenirken bir hata oluştu',
      details: error.message 
    });
  }
});

// Randevu taleplerini listeleyen endpoint
app.get('/api/appointment-requests/:storeOwnerId', async (req, res) => {
  try {
    const { storeOwnerId } = req.params;
    console.log('Appointment requests endpoint çağrıldı, storeOwnerId:', storeOwnerId);
    
    // Store owner ID'nin geçerli olup olmadığını kontrol et
    if (!mongoose.Types.ObjectId.isValid(storeOwnerId)) {
      console.log('Geçersiz store owner ID:', storeOwnerId);
      return res.status(400).json({ error: 'Geçersiz store owner ID' });
    }

    // Randevu taleplerini getir - hem string hem ObjectId formatında dene
    const appointmentRequests = await AppointmentRequest.find({ 
      $or: [
        { storeOwnerId: storeOwnerId },
        { storeOwnerId: new mongoose.Types.ObjectId(storeOwnerId) }
      ]
    }).sort({ createdAt: -1 }); // En yeni önce

    console.log('Bulunan randevu talepleri:', appointmentRequests.length);
    console.log('Randevu talepleri:', appointmentRequests);

    res.status(200).json({
      success: true,
      appointmentRequests: appointmentRequests
    });

  } catch (error) {
    console.error('Randevu talepleri getirme hatası:', error);
    res.status(500).json({ 
      error: 'Randevu talepleri getirilirken bir hata oluştu',
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});

// Global error handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Randevuya ödeme ekle
app.post('/api/appointments/:id/payments', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    const appointmentId = req.params.id;
    const { amount, method, note, date } = req.body;

    if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) < 0) {
      return res.status(400).json({ error: 'Geçerli bir ödeme tutarı girin' });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res.status(404).json({ error: 'Randevu bulunamadı' });
    }

    // Yetki: Aynı işletmeye ait olmalı
    if (appointment.businessId.toString() !== user.businessId.toString()) {
      return res.status(403).json({ error: 'Bu randevuya ödeme ekleme yetkiniz yok' });
    }

    const paymentRecord = {
      amount: Number(amount),
      method: method || 'nakit',
      note: note || '',
      date: date ? new Date(date) : new Date(),
      recordedBy: user._id
    };

    const updated = await Appointment.findByIdAndUpdate(
      appointmentId,
      { $push: { payments: paymentRecord }, $set: { updatedAt: new Date() } },
      { new: true }
    ).populate('createdBy', 'name userType');

    return res.json({ appointment: updated });
  } catch (error) {
    console.error('Ödeme eklenirken hata:', error);
    return res.status(500).json({ error: 'Ödeme eklenirken sunucu hatası oluştu' });
  }
});