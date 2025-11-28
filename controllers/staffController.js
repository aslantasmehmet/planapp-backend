const path = require('path');
const fs = require('fs');
const config = require('../config');
const User = require('../models/User');
const Business = require('../models/Business');
const SmsLog = require('../models/SmsLog');
const { sendSms } = require('../services/smsService');

const MUTLUCELL_ORIGINATOR = config.MUTLUCELL.ORIGINATOR;
const MUTLUCELL_VALIDITY = config.MUTLUCELL.VALIDITY;
const PROVIDER_CONFIGURED = !!(config.MUTLUCELL.USERNAME && config.MUTLUCELL.PASSWORD);

const normalizeMsisdn = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  let msisdn = digits;
  if (msisdn.startsWith('0')) msisdn = msisdn.slice(1);
  if (msisdn.startsWith('90')) msisdn = msisdn.slice(2);
  return `90${msisdn}`;
};

// POST /api/staff
exports.createStaff = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const ownerId = req.user.userId;

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'Tüm alanlar gereklidir' });
    }

    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel ekleyebilir' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu e-posta adresi ile zaten bir hesap var' });
    }

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

    try {
      const msisdn = normalizeMsisdn(phone);
      let businessName = '';
      try {
        const biz = await Business.findById(owner.businessId).lean();
        businessName = biz?.name || '';
      } catch (_) {}

      const msg = `Merhaba ${name},Planyapp giriş şifreniz: ${password}\nGiriş e-postanız: ${email}`;
      if (msisdn.length >= 12) {
        const smsLog = new SmsLog({
          businessId: owner.businessId,
          userId: ownerId,
          msisdn,
          message: msg,
          status: 'queued'
        });
        await smsLog.save();

        let result = { success: false, error: 'SMS provider not configured' };
        if (PROVIDER_CONFIGURED) {
          result = await sendSms({ dest: msisdn, msg, originator: MUTLUCELL_ORIGINATOR, validFor: MUTLUCELL_VALIDITY });
        }

        if (result?.success) {
          smsLog.status = 'sent';
          smsLog.providerMessageId = result.providerMessageId || undefined;
          smsLog.sentAt = new Date();
        } else {
          smsLog.status = 'failed';
          smsLog.error = result?.error || 'SMS gönderimi başarısız';
        }
        await smsLog.save();
      }
    } catch (smsErr) { }

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
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// GET /api/staff
exports.listStaff = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    let staffList;
    if (user.userType === 'owner') {
      staffList = await User.find({ userType: 'staff', createdBy: userId }).select('-password').sort({ createdAt: -1 });
    } else {
      staffList = await User.find({ userType: 'staff', businessId: user.businessId, _id: { $ne: userId } }).select('-password').sort({ createdAt: -1 });
    }

    res.json({ staff: staffList });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// PUT /api/staff/:id
exports.updateStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, phone } = req.body;
    const ownerId = req.user.userId;

    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel güncelleyebilir' });
    }

    const staff = await User.findOne({ _id: id, userType: 'staff', createdBy: ownerId });
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    if (email && email !== staff.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: id } });
      if (existingUser) {
        return res.status(400).json({ error: 'Bu e-posta adresi ile zaten bir hesap var' });
      }
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (phone) updateData.phone = phone;

    const updatedStaff = await User.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).select('-password');
    res.json({ message: 'Personel başarıyla güncellendi', staff: updatedStaff });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// PUT /api/staff/:id/working-hours
exports.updateStaffWorkingHours = async (req, res) => {
  try {
    const { id } = req.params;
    const { workingHours } = req.body;
    const ownerId = req.user.userId;

    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel çalışma saatlerini güncelleyebilir' });
    }

    const staff = await User.findOne({ _id: id, userType: 'staff', createdBy: ownerId });
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    if (!workingHours || typeof workingHours !== 'object') {
      return res.status(400).json({ error: 'Geçerli çalışma saatleri gerekli' });
    }

    const updatedStaff = await User.findByIdAndUpdate(id, { workingHours }, { new: true, runValidators: true }).select('-password');
    res.json({ message: 'Personel çalışma saatleri başarıyla güncellendi', staff: updatedStaff, workingHours: updatedStaff.workingHours });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// DELETE /api/staff/:id
exports.deleteStaff = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;

    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel silebilir' });
    }

    const staff = await User.findOne({ _id: id, userType: 'staff', createdBy: ownerId });
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    await User.findByIdAndDelete(id);
    res.json({ message: 'Personel başarıyla silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// POST /api/staff/:id/upload-avatar
exports.uploadStaffAvatar = async (req, res) => {
  try {
    const { id } = req.params;
    const { avatar } = req.body;
    const ownerId = req.user.userId;

    if (!avatar) {
      return res.status(400).json({ error: 'Avatar verisi bulunamadı. Lütfen dosya seçtiğinizden emin olun.' });
    }
    if (!avatar.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Geçersiz avatar formatı' });
    }

    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri avatar yükleyebilir' });
    }

    const staff = await User.findOne({ _id: id, userType: 'staff', createdBy: ownerId });
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    await User.findByIdAndUpdate(id, { avatar });
    res.json({ message: 'Avatar başarıyla yüklendi', avatar });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// DELETE /api/staff/:id/avatar
exports.deleteStaffAvatar = async (req, res) => {
  try {
    const { id } = req.params;
    const ownerId = req.user.userId;

    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri avatar silebilir' });
    }

    const staff = await User.findOne({ _id: id, userType: 'staff', createdBy: ownerId });
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    await User.findByIdAndUpdate(id, { $unset: { avatar: 1 } });
    res.json({ message: 'Avatar başarıyla silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// GET /api/services/staff/:staffId
exports.getStaffServices = async (req, res) => {
  try {
    const { staffId } = req.params;
    const ownerId = req.user.userId;

    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri staff hizmetlerini görebilir' });
    }

    const staff = await User.findOne({ _id: staffId, userType: 'staff', createdBy: ownerId }).select('services name');
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    const services = staff.services || [];
    res.json({ success: true, services, staffName: staff.name });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// POST /api/staff/:staffId/services
exports.addStaffService = async (req, res) => {
  try {
    const { staffId } = req.params;
    const { serviceData } = req.body;
    const ownerId = req.user.userId;

    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personele hizmet ekleyebilir' });
    }

    if (!serviceData || !serviceData.name) {
      return res.status(400).json({ error: 'Hizmet adı gereklidir' });
    }

    const staff = await User.findOne({ _id: staffId, userType: 'staff', createdBy: ownerId });
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    const currentServices = staff.services || [];
    const existingService = currentServices.find(s => (typeof s === 'string' ? s : s.name) === serviceData.name.trim());
    if (existingService) {
      return res.status(400).json({ error: 'Bu hizmet bu personel için zaten mevcut' });
    }

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

    const updatedServices = [...currentServices, newService];
    await User.findByIdAndUpdate(staffId, { services: updatedServices }, { new: true });

    res.json({ success: true, message: 'Hizmet personele başarıyla eklendi', service: newService, services: updatedServices });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// DELETE /api/staff/:staffId/services/:serviceId
exports.deleteStaffService = async (req, res) => {
  try {
    const { staffId, serviceId } = req.params;
    const ownerId = req.user.userId;

    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri personel hizmetlerini silebilir' });
    }

    const staff = await User.findOne({ _id: staffId, userType: 'staff', createdBy: ownerId });
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
    }

    const currentServices = staff.services || [];
    const updatedServices = currentServices.filter(service => (typeof service === 'string' ? service : service.id) !== serviceId);
    if (updatedServices.length === currentServices.length) {
      return res.status(404).json({ error: 'Silinecek hizmet bulunamadı' });
    }

    await User.findByIdAndUpdate(staffId, { services: updatedServices }, { new: true });
    res.json({ success: true, message: 'Hizmet personelden başarıyla silindi', services: updatedServices });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};
