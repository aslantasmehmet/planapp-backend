const path = require('path');
const fs = require('fs');
const config = require('../config');
const User = require('../models/User');
const Business = require('../models/Business');
const SmsLog = require('../models/SmsLog');
const StaffCompensation = require('../models/StaffCompensation');
const StaffPayment = require('../models/StaffPayment');
const CashEntry = require('../models/CashEntry');
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

async function resolveBusinessId(userId) {
  const actor = await User.findById(userId).select('businessId userType createdBy').lean();
  if (!actor) return null;
  let effectiveBusinessId = actor.businessId || null;
  if (!effectiveBusinessId && actor.userType === 'owner') {
    const biz = await Business.findOne({ ownerId: actor._id }).select('_id');
    if (biz) effectiveBusinessId = biz._id;
  }
  if (!effectiveBusinessId && actor.userType === 'staff') {
    const fallbackBiz = await Business.findOne({ ownerId: actor.createdBy || actor.businessId }).select('_id');
    if (fallbackBiz) effectiveBusinessId = fallbackBiz._id;
  }
  return effectiveBusinessId;
}

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
    const { name, email, phone, iban } = req.body;
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
    if (typeof iban !== 'undefined') updateData.iban = String(iban || '').trim();

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

exports.getCompensation = async (req, res) => {
  try {
    const { id } = req.params;
    const owner = await User.findById(req.user.userId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Yetkisiz işlem' });
    }
    const staff = await User.findOne({ _id: id, userType: 'staff', createdBy: owner._id }).select('_id');
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı' });
    }
    const businessId = await resolveBusinessId(owner._id);
    const doc = await StaffCompensation.findOne({ businessId, staffId: staff._id }).lean();
    if (!doc) return res.json({ model: 'salary', salaryAmount: 0, fixedAmount: 0, percentage: 0, payday: 1 });
    return res.json(doc);
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.upsertCompensation = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const owner = await User.findById(req.user.userId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Yetkisiz işlem' });
    }
    const staff = await User.findOne({ _id: id, userType: 'staff', createdBy: owner._id }).select('_id');
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı' });
    }
    const model = ['salary', 'fixed', 'percentage'].includes(String(payload.model)) ? String(payload.model) : 'salary';
    const salaryAmount = Number(payload.salaryAmount || 0) || 0;
    const fixedAmount = Number(payload.fixedAmount || 0) || 0;
    const percentage = Number(payload.percentage || 0) || 0;
    const payday = Math.min(31, Math.max(1, Number(payload.payday || 1) || 1));
    const businessId = await resolveBusinessId(owner._id);
    const doc = await StaffCompensation.findOneAndUpdate(
      { businessId, staffId: staff._id },
      { model, salaryAmount, fixedAmount, percentage, payday, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, compensation: doc });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.listStaffPayments = async (req, res) => {
  try {
    const { id } = req.params;
    const actor = await User.findById(req.user.userId);
    if (!actor) {
      return res.status(403).json({ error: 'Yetkisiz işlem' });
    }
    let staff;
    if (actor.userType === 'owner') {
      staff = await User.findOne({ _id: id, userType: 'staff', createdBy: actor._id }).select('_id');
    } else if (actor.userType === 'staff' && String(actor._id) === String(id)) {
      staff = actor;
    }
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı' });
    }
    const businessId = await resolveBusinessId(actor._id);
    const items = await StaffPayment.find({ businessId, staffId: staff._id }).sort({ date: -1, createdAt: -1 }).lean();
    return res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.createStaffPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const owner = await User.findById(req.user.userId);
    if (!owner || owner.userType !== 'owner') {
      return res.status(403).json({ error: 'Yetkisiz işlem' });
    }
    const staff = await User.findOne({ _id: id, userType: 'staff', createdBy: owner._id }).select('_id');
    if (!staff) {
      return res.status(404).json({ error: 'Personel bulunamadı' });
    }
    const isSalary = !!payload.isSalary;
    const businessId = await resolveBusinessId(owner._id);
    let amt = Number(payload.amount || 0);
    let salaryMonth = '';
    if (isSalary) {
      const comp = await StaffCompensation.findOne({ businessId, staffId: staff._id }).lean();
      if (!comp || String(comp.model) !== 'salary') {
        return res.status(400).json({ error: 'Bu personel için maaş modeli seçilmemiş' });
      }
      const d = new Date();
      const defMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      salaryMonth = String(payload.salaryMonth || defMonth);
      amt = Number(payload.amount || 0) || Number(comp.salaryAmount || 0) || 0;
      if (amt <= 0) {
        return res.status(400).json({ error: 'Maaş tutarı geçersiz' });
      }
      let dateForSalary = new Date();
      try {
        const [yy, mm] = salaryMonth.split('-').map(n => parseInt(n, 10));
        if (yy && mm) {
          const payday = Math.min(31, Math.max(1, Number((comp && comp.payday) || 1) || 1));
          dateForSalary = new Date(yy, mm - 1, payday);
        }
      } catch (_) {}
      const existingSalary = await StaffPayment.findOne({ businessId, staffId: staff._id, isSalary: true, salaryMonth }).lean();
      if (existingSalary) {
        const status = ['Paid','Pending'].includes(String(payload.status)) ? String(payload.status) : 'Pending';
        await StaffPayment.updateOne({ _id: existingSalary._id }, { $set: { amount: amt, compModel: 'salary', compSalaryAmount: amt, isSalary: true, salaryMonth, status, date: dateForSalary } });
        const updated = await StaffPayment.findById(existingSalary._id).lean();
        try {
          const marker = `\[SALARY:${String(staff._id)}:${String(salaryMonth)}\]`;
          if (status === 'Paid') {
            const existsExpense = await CashEntry.findOne({ businessId, type: 'expense', note: { $regex: marker } }).lean();
            if (!existsExpense) {
              let staffName = '';
              try { const sdoc = await User.findById(staff._id).select('name').lean(); staffName = sdoc?.name || ''; } catch (_) {}
              const noteText = `Maaş ödemesi - ${staffName} - ${salaryMonth} [SALARY:${String(staff._id)}:${String(salaryMonth)}]`;
              await CashEntry.create({ businessId, createdBy: owner._id, type: 'expense', amount: amt, method: 'nakit', note: noteText, date: dateForSalary, status: 'Paid', paidAt: dateForSalary });
            }
          } else {
            await CashEntry.deleteMany({ businessId, type: 'expense', note: { $regex: marker } });
          }
        } catch (_) {}
        return res.json({ success: true, payment: updated });
      }
    } else {
      if (!amt || isNaN(amt) || amt <= 0) {
        return res.status(400).json({ error: 'Geçersiz tutar' });
      }
    }

    // De-dup: existing record by paymentId or appointmentId+amount
    try {
      const pid = payload.paymentId && String(payload.paymentId).match(/^[0-9a-fA-F]{24}$/) ? String(payload.paymentId) : null;
      if (pid) {
        const byPid = await StaffPayment.findOne({ businessId, staffId: staff._id, paymentId: pid }).lean();
        if (byPid) return res.json({ success: true, payment: byPid, deduped: true });
      }
      const apptKey = String(payload.appointmentId || '');
      if (apptKey) {
        const byAppt = await StaffPayment.findOne({ businessId, staffId: staff._id, appointmentId: apptKey, amount: amt }).lean();
        if (byAppt) return res.json({ success: true, payment: byAppt, deduped: true });
      }
    } catch (_) {}
    const comp = await StaffCompensation.findOne({ businessId, staffId: staff._id }).lean();
    let staffShare = 0;
    let businessShare = amt;
    let compModel = '';
    let compFixedAmount = 0;
    let compPercentage = 0;
    let compSalaryAmount = 0;
    if (comp) {
      compModel = comp.model || '';
      compFixedAmount = Number(comp.fixedAmount || 0) || 0;
      compPercentage = Number(comp.percentage || 0) || 0;
      compSalaryAmount = Number(comp.salaryAmount || 0) || 0;
      if (comp.model === 'fixed') {
        staffShare = Math.max(0, compFixedAmount);
        businessShare = Math.max(0, amt - staffShare);
      } else if (comp.model === 'percentage') {
        const base = (amt * compPercentage) / 100;
        staffShare = Math.max(0, Math.round(base * 100) / 100);
        businessShare = Math.max(0, Math.round((amt - staffShare) * 100) / 100);
      } else {
        staffShare = 0;
        businessShare = amt;
      }
    }
    let dateForSalary = null;
    if (isSalary) {
      try {
        const [yy, mm] = salaryMonth.split('-').map(n => parseInt(n, 10));
        if (yy && mm) {
          const payday = Math.min(31, Math.max(1, Number((comp && comp.payday) || 1) || 1));
          dateForSalary = new Date(yy, mm - 1, payday);
        }
      } catch (_) {}
    }
    const doc = await StaffPayment.create({
      businessId,
      staffId: staff._id,
      paymentId: payload.paymentId && String(payload.paymentId).match(/^[0-9a-fA-F]{24}$/) ? payload.paymentId : undefined,
      appointmentId: String(payload.appointmentId || ''),
      customerId: String(payload.customerId || ''),
      clientName: String(payload.clientName || ''),
      service: String(payload.service || ''),
      date: (dateForSalary || (payload.date ? new Date(payload.date) : new Date())),
      time: String(payload.time || ''),
      amount: amt,
      method: ['nakit', 'kart', 'havale'].includes(String(payload.method)) ? String(payload.method) : 'nakit',
      note: String(payload.note || ''),
      staffShare,
      businessShare,
      compModel,
      compFixedAmount,
      compPercentage,
      compSalaryAmount,
      isSalary,
      salaryMonth,
      status: isSalary ? (['Paid','Pending'].includes(String(payload.status)) ? String(payload.status) : 'Pending') : 'Paid'
    });
    if (isSalary) {
      try {
        const status = doc.status;
        const marker = `\[SALARY:${String(staff._id)}:${String(salaryMonth)}\]`;
        if (status === 'Paid') {
          const existsExpense = await CashEntry.findOne({ businessId, type: 'expense', note: { $regex: marker } }).lean();
          if (!existsExpense) {
            let staffName = '';
            try { const sdoc = await User.findById(staff._id).select('name').lean(); staffName = sdoc?.name || ''; } catch (_) {}
            const noteText = `Maaş ödemesi - ${staffName} - ${salaryMonth} [SALARY:${String(staff._id)}:${String(salaryMonth)}]`;
            await CashEntry.create({ businessId, createdBy: owner._id, type: 'expense', amount: amt, method: 'nakit', note: noteText, date: dateForSalary || new Date(), status: 'Paid', paidAt: dateForSalary || new Date() });
          }
        } else {
          await CashEntry.deleteMany({ businessId, type: 'expense', note: { $regex: marker } });
        }
      } catch (_) {}
    }
    return res.json({ success: true, payment: doc });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};
