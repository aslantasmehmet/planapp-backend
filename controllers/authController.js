const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Business = require('../models/Business');
const OtpCode = require('../models/OtpCode');
const { JWT_SECRET, MUTLUCELL } = require('../config');
const { sendSms } = require('../services/smsService');
const { normalizeMsisdn, maskMsisdn } = require('../utils/phone');

async function register(req, res) {
  try {
    const { password, name, email, phone } = req.body;

    if (!password || !name || !email || !phone) {
      return res.status(400).json({ error: 'Ad, e-posta, telefon ve şifre alanları gereklidir' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu e-posta adresi ile zaten bir hesap var' });
    }

    const existingPhoneUser = await User.findOne({ phone });
    if (existingPhoneUser) {
      return res.status(400).json({ error: 'Bu telefon numarası ile zaten bir hesap var' });
    }

    const user = new User({ name, email, phone, password, userType: 'owner', isPremium: false, trialStart: new Date() });
    await user.save();

    if (user.userType === 'owner') {
      user.businessId = user._id;
      await user.save();
    }

    const token = jwt.sign({ userId: user._id.toString(), email: user.email, userType: user.userType }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
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
        trialStart: user.trialStart,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function registerInit(req, res) {
  try {
    const { password, name, email, phone } = req.body || {};
    if (!password || !name || !email || !phone) {
      return res.status(400).json({ error: 'Ad, e-posta, telefon ve şifre alanları gereklidir' });
    }

    const emailNorm = String(email).toLowerCase().trim();
    const existingUser = await User.findOne({ email: emailNorm });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu e-posta adresi ile zaten bir hesap var' });
    }

    const phoneStr = String(phone).trim();
    const existingPhoneUser = await User.findOne({ phone: phoneStr });
    if (existingPhoneUser) {
      return res.status(400).json({ error: 'Bu telefon numarası ile zaten bir hesap var' });
    }

    const msisdn = normalizeMsisdn(phone);
    if (!msisdn || msisdn.length < 10) {
      return res.status(400).json({ error: 'Telefon numarası geçerli değil' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const otp = await OtpCode.create({
      user: null,
      phone: msisdn,
      code,
      status: 'pending',
      expiresAt,
      purpose: 'register',
      payload: {
        name,
        email: emailNorm,
        phoneRaw: String(phone),
        password: String(password),
        userType: 'owner',
        isPremium: false,
        trialStart: new Date(),
      },
    });

    const msg = `Kayıt doğrulama kodunuz: ${code}\nKod 5 dakika geçerlidir.\nPaylaşmayınız.`;
    let smsError = null;
    const providerConfigured = (MUTLUCELL.USERNAME && MUTLUCELL.PASSWORD);
    const originator = MUTLUCELL.ORIGINATOR;
    const validForParam = MUTLUCELL.VALIDITY;
    if (providerConfigured) {
      const sendRes = await sendSms({ dest: msisdn, msg, originator, validFor: validForParam, customId: `reg_${otp._id.toString()}` });
      if (!sendRes.success) smsError = sendRes.error || 'SMS gönderilemedi';
    } else {
      smsError = 'SMS sağlayıcı yapılandırılmamış';
    }

    const masked = maskMsisdn(msisdn);
    if (smsError) {
      return res.status(500).json({ error: `OTP SMS gönderimi başarısız: ${smsError}` });
    }

    return res.json({ message: 'Kayıt için OTP gönderildi', twoFactorRequired: true, otpId: otp._id, maskedPhone: masked || null });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function registerVerify(req, res) {
  try {
    const { otpId, code } = req.body || {};
    if (!otpId || !code) {
      return res.status(400).json({ error: 'OTP kimliği ve kod gereklidir' });
    }

    const otp = await OtpCode.findById(otpId);
    if (!otp) return res.status(404).json({ error: 'OTP kaydı bulunamadı' });
    if (otp.purpose !== 'register') return res.status(400).json({ error: 'OTP kayıt akışı için değil' });
    if (otp.status !== 'pending') return res.status(400).json({ error: 'OTP kullanılabilir durumda değil' });
    if (otp.expiresAt < new Date()) {
      otp.status = 'expired';
      await otp.save();
      return res.status(400).json({ error: 'Kodun süresi doldu' });
    }
    if (String(otp.code) !== String(code)) {
      otp.attempts = (otp.attempts || 0) + 1;
      await otp.save();
      return res.status(401).json({ error: 'Kod yanlış' });
    }

    const payload = otp.payload || {};
    const existingUser = await User.findOne({ email: payload.email });
    if (existingUser) {
      otp.status = 'expired';
      await otp.save();
      return res.status(400).json({ error: 'Bu e-posta ile zaten hesap var' });
    }

    const existingPhoneUser = await User.findOne({ phone: payload.phoneRaw });
    if (existingPhoneUser) {
      otp.status = 'expired';
      await otp.save();
      return res.status(400).json({ error: 'Bu telefon numarası ile zaten hesap var' });
    }

    const user = new User({
      name: payload.name,
      email: payload.email,
      phone: payload.phoneRaw,
      password: payload.password,
      userType: payload.userType || 'owner',
      isPremium: payload.isPremium ?? false,
      trialStart: payload.trialStart || new Date(),
    });
    await user.save();

    if (user.userType === 'owner') {
      user.businessId = user._id;
      await user.save();
    }

    otp.status = 'verified';
    otp.user = user._id;
    await otp.save();

    const token = jwt.sign({ userId: user._id.toString(), email: user.email, userType: user.userType }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(201).json({
      message: 'Kayıt tamamlandı',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType,
        businessId: user.businessId,
        isPremium: user.isPremium,
        trialStart: user.trialStart,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-posta ve şifre gereklidir' });
    }
    const emailNorm = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: emailNorm });
    if (!user) return res.status(404).json({ error: 'E-posta bulunamadı' });
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) return res.status(401).json({ error: 'Şifre yanlış' });

    const msisdn = normalizeMsisdn(user.phone);
    if (!msisdn || msisdn.length < 10) {
      return res.status(400).json({ error: '2FA için geçerli bir telefon numarası gerekli' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const otp = await OtpCode.create({ user: user._id, phone: msisdn, code, status: 'pending', expiresAt });

    const msg = `Giriş doğrulama kodunuz: ${code}\nKod 5 dakika geçerlidir.\nPaylaşmayınız.`;
    let smsError = null;
    const providerConfigured = (MUTLUCELL.USERNAME && MUTLUCELL.PASSWORD);
    const originator = MUTLUCELL.ORIGINATOR;
    const validForParam = MUTLUCELL.VALIDITY;
    if (providerConfigured) {
      const sendRes = await sendSms({ dest: msisdn, msg, originator, validFor: validForParam, customId: `otp_${otp._id.toString()}` });
      if (!sendRes.success) smsError = sendRes.error || 'SMS gönderilemedi';
    } else {
      smsError = 'SMS sağlayıcı yapılandırılmamış';
    }

    const masked = maskMsisdn(msisdn);
    if (smsError) {
      return res.status(500).json({ error: `OTP SMS gönderimi başarısız: ${smsError}` });
    }
    return res.json({ message: '2FA başlatıldı', twoFactorRequired: true, otpId: otp._id, maskedPhone: masked || null });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function verifyOtp(req, res) {
  try {
    const { otpId, code } = req.body || {};
    if (!otpId || !code) {
      return res.status(400).json({ error: 'OTP kimliği ve kod gereklidir' });
    }
    const otp = await OtpCode.findById(otpId).populate('user');
    if (!otp) return res.status(404).json({ error: 'OTP kaydı bulunamadı' });
    if (otp.status !== 'pending') return res.status(400).json({ error: 'OTP kullanılabilir durumda değil' });
    if (otp.expiresAt < new Date()) {
      otp.status = 'expired';
      await otp.save();
      return res.status(400).json({ error: 'Kodun süresi doldu' });
    }
    if (String(otp.code) !== String(code)) {
      otp.attempts = (otp.attempts || 0) + 1;
      await otp.save();
      return res.status(401).json({ error: 'Kod yanlış' });
    }

    otp.status = 'verified';
    await otp.save();
    const user = otp.user;
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const token = jwt.sign({ userId: user._id.toString(), email: user.email, userType: user.userType }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({
      message: 'OTP doğrulandı',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        userType: user.userType,
        businessId: user.businessId,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function profile(req, res) {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const trialStart = user.createdAt;
    const TRIAL_DAYS = 7;
    const trialEndsAt = new Date(trialStart.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const now = new Date();
    const isTrialActive = !user.isPremium && now < trialEndsAt;
    const daysLeft = isTrialActive ? Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)) : 0;

    return res.json({ user: {
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
      trialActive: isTrialActive,
    } });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

module.exports = {
  register,
  registerInit,
  registerVerify,
  login,
  verifyOtp,
  profile,
};
