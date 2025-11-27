const mongoose = require('mongoose');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Business = require('../models/Business');
const SmsLog = require('../models/SmsLog');
const { sendSms } = require('../services/smsService');
const { MUTLUCELL } = require('../config');
const { normalizeMsisdn } = require('../utils/phone');

async function updateAppointmentStatuses(appointments) {
  const now = new Date();
  const updatedAppointments = [];

  for (let appointment of appointments) {
    try {
      if (appointment?.status === 'cancelled' || appointment?.status === 'blocked' || appointment?.isBlocked === true) {
        updatedAppointments.push(appointment);
        continue;
      }

      const date = new Date(appointment.date);
      const [endH, endM] = String(appointment.endTime || '23:59').split(':');
      const endDateTime = new Date(date);
      endDateTime.setHours(Number(endH) || 23, Number(endM) || 59, 0, 0);

      let newStatus = appointment.status;
      let needsUpdate = false;

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
      updatedAppointments.push(appointment);
    }
  }

  return updatedAppointments;
}

async function list(req, res) {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });

    let query = { businessId: user.businessId };
    const { staffId, serviceId } = req.query;

    if (user.userType === 'staff') {
      query.createdBy = user._id;
      if (serviceId && serviceId !== 'all') query.serviceId = serviceId;
    } else if (user.userType === 'owner') {
      if (staffId && staffId !== 'all') query.createdBy = staffId;
      if (serviceId && serviceId !== 'all') query.serviceId = serviceId;
    }

    let appointments = await Appointment.find(query)
      .populate('createdBy', 'name email userType')
      .populate('userId', 'name email userType')
      .sort({ date: 1, startTime: 1 });

    for (let appointment of appointments) {
      if (!appointment.createdBy && appointment.userId) {
        await Appointment.findByIdAndUpdate(appointment._id, { createdBy: appointment.userId });
        appointment.createdBy = await User.findById(appointment.userId).select('name email userType');
      }
    }

    appointments = await updateAppointmentStatuses(appointments);
    return res.json({ appointments });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function create(req, res) {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });

    let appointmentOwnerId = req.user.userId;
    if (user.userType === 'staff') {
      let ownerIdFromBusiness = null;
      try {
        if (user.businessId && mongoose.Types.ObjectId.isValid(user.businessId.toString())) {
          const business = await Business.findById(user.businessId);
          if (business && business.ownerId && mongoose.Types.ObjectId.isValid(business.ownerId.toString())) {
            ownerIdFromBusiness = business.ownerId;
          } else {
            const ownerFallback = await User.findOne({ _id: user.businessId, userType: 'owner' });
            if (ownerFallback) {
              ownerIdFromBusiness = ownerFallback._id;
              const maybeBiz = await Business.findOne({ ownerId: ownerFallback._id });
              if (maybeBiz) { try { await User.findByIdAndUpdate(user._id, { businessId: maybeBiz._id }); } catch (_) {} }
            }
          }
        }
      } catch (e) { }
      if (ownerIdFromBusiness) appointmentOwnerId = ownerIdFromBusiness;
    }

    let createdById = req.user.userId;
    if (user.userType === 'owner' && req.body.selectedStaff && req.body.selectedStaff !== 'all') {
      createdById = req.body.selectedStaff;
    }

    const planQuotaMap = { plus: 200, pro: 400, premium: null };
    const isBlockedAppointment = !!req.body.isBlocked;
    let ownerDoc = null;
    if (user.userType === 'staff') {
      try {
        const bizDocForOwner = await Business.findById(user.businessId);
        if (bizDocForOwner && bizDocForOwner.ownerId) {
          ownerDoc = await User.findById(bizDocForOwner.ownerId);
        } else {
          const ownerCandidate = await User.findById(user.businessId);
          if (ownerCandidate && ownerCandidate.userType === 'owner') ownerDoc = ownerCandidate;
        }
      } catch (e) { }
      if (!ownerDoc && !isBlockedAppointment) return res.status(403).json({ error: 'İşletme sahibi bulunamadı. Lütfen işletme ayarlarınızı kontrol edin.' });
    }
    const enforcementTarget = ownerDoc || user;
    const now = new Date();
    const TRIAL_DAYS = 7;
    const trialStartLocal = enforcementTarget.createdAt || new Date(0);
    const trialEndsAtLocal = new Date(trialStartLocal.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    if (!enforcementTarget.isPremium && now >= trialEndsAtLocal && !isBlockedAppointment) {
      return res.status(403).json({ error: 'Deneme süreniz bitti. Paket satın almadan randevu oluşturamazsınız.' });
    }

    try {
      const membershipEndsAtLocal = enforcementTarget.membershipEndsAt ? new Date(enforcementTarget.membershipEndsAt) : null;
      const membershipExpiredLocal = !!(membershipEndsAtLocal && now >= membershipEndsAtLocal);
      if (membershipExpiredLocal && !isBlockedAppointment) {
        return res.status(403).json({ error: 'Üyelik süreniz sona erdi. Paket yenilenmeden randevu oluşturamazsınız.' });
      }
    } catch (_) {}

    try {
      const effectiveMonthlyQuota = planQuotaMap[enforcementTarget.planType] ?? enforcementTarget.monthlyQuota ?? null;
      if (enforcementTarget.isPremium && effectiveMonthlyQuota != null && !isBlockedAppointment) {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        let legacyOwnerId = null;
        if (user.userType === 'owner') legacyOwnerId = user._id; else {
          let bizDoc = null;
          try { if (user.businessId && mongoose.Types.ObjectId.isValid(user.businessId.toString())) bizDoc = await Business.findById(user.businessId); } catch (e) { }
          if (bizDoc && bizDoc.ownerId && mongoose.Types.ObjectId.isValid(bizDoc.ownerId.toString())) legacyOwnerId = bizDoc.ownerId; else {
            try {
              if (user.businessId && mongoose.Types.ObjectId.isValid(user.businessId.toString())) {
                const ownerCandidate = await User.findById(user.businessId);
                if (ownerCandidate && ownerCandidate.userType === 'owner') legacyOwnerId = ownerCandidate._id;
              }
            } catch (e) { }
          }
        }
        const legacyOwnerIdStr = legacyOwnerId?.toString?.();
        const businessIdStr = user.businessId?.toString?.() || String(user.businessId);
        const businessIdQuery = legacyOwnerIdStr && legacyOwnerIdStr !== businessIdStr ? { $in: [user.businessId, legacyOwnerId] } : user.businessId;
        const usedCountThisMonth = await Appointment.countDocuments({
          businessId: businessIdQuery,
          isBlocked: false,
          status: { $ne: 'cancelled' },
          $or: [
            { createdAt: { $gte: startOfMonth, $lte: endOfMonth } },
            { $and: [ { createdAt: { $exists: false } }, { date: { $gte: startOfMonth, $lte: endOfMonth } } ] }
          ]
        });
        if (usedCountThisMonth >= effectiveMonthlyQuota) {
          return res.status(403).json({ error: 'Aylık randevu hakkınız doldu. Lütfen paket yükseltin veya yeni dönem başlayınca tekrar deneyin.' });
        }
      }
    } catch (quotaErr) { }

    if (req.body.isBlocked) {
      req.body.status = 'blocked';
      if (!req.body.title || !req.body.title.trim()) req.body.title = 'Bloke Edilmiş Saat';
      if (!req.body.service || !req.body.service.trim()) req.body.service = 'Bloke Edilmiş Saat';
      if (!req.body.type || !req.body.type.trim()) req.body.type = 'Bloke Edilmiş Saat';
    }

    const appointmentData = { ...req.body, userId: appointmentOwnerId, businessId: user.businessId, createdBy: createdById };
    delete appointmentData.selectedStaff;
    const appointment = new Appointment(appointmentData);
    await appointment.save();

    try {
      if (!appointment.isBlocked) {
        const businessDoc = await Business.findById(appointment.businessId);
        const businessName = businessDoc?.name || 'Mağaza';
        const addressText = businessDoc?.address || '';
        const formatDateTR = (d) => { const dd = d.getDate().toString().padStart(2, '0'); const mm = (d.getMonth() + 1).toString().padStart(2, '0'); const yyyy = d.getFullYear(); return `${dd}.${mm}.${yyyy}`; };
        const startDate = new Date(appointment.date);
        const startTimeStr = String(appointment.startTime || '').trim();
        const endTimeStr = String(appointment.endTime || '').trim();
        const customerName = String(appointment.clientName || '').trim();
        const customerPhone = String(appointment.clientPhone || '').trim();
        const serviceNameEffective = String(appointment.title || appointment.type || 'Hizmet').trim();
        const providerUserId = appointment.createdBy || appointment.userId;
        const providerUser = providerUserId ? await User.findById(providerUserId) : null;
        const providerMsisdn = normalizeMsisdn(providerUser?.phone || user.phone);
        const customerMsisdn = normalizeMsisdn(customerPhone);
        const customerMsg = `Randevunuz onaylandı: ${businessName} ${formatDateTR(startDate)} ${startTimeStr}-${endTimeStr}. ${addressText ? `Adres: ${addressText}` : ''}`.trim();
        const providerMsg = `Yeni randevu: ${customerName}, ${serviceNameEffective}, ${formatDateTR(startDate)} ${startTimeStr}-${endTimeStr}. Tel: ${customerPhone}`;
        if (customerMsisdn) {
          try {
            const customerLog = new SmsLog({ businessId: appointment.businessId, userId: providerUserId, appointmentId: appointment._id, msisdn: customerMsisdn, message: customerMsg, status: 'queued' });
            await customerLog.save();
            const sendRes = await sendSms({ dest: customerMsisdn, msg: customerMsg, originator: MUTLUCELL.ORIGINATOR, validFor: MUTLUCELL.VALIDITY, customId: String(appointment._id) });
            if (sendRes && !sendRes.error && sendRes.success !== false) {
              customerLog.status = 'sent'; customerLog.providerMessageId = sendRes.providerMessageId || undefined; customerLog.sentAt = new Date();
            } else { customerLog.status = 'failed'; customerLog.error = (sendRes && sendRes.error) ? sendRes.error : 'SMS gönderimi başarısız'; }
            await customerLog.save();
          } catch (smsErr) { }
        }
        if (providerMsisdn) {
          try {
            const providerLog = new SmsLog({ businessId: appointment.businessId, userId: providerUserId, appointmentId: appointment._id, msisdn: providerMsisdn, message: providerMsg, status: 'queued' });
            await providerLog.save();
            const sendRes2 = await sendSms({ dest: providerMsisdn, msg: providerMsg, originator: MUTLUCELL.ORIGINATOR, validFor: MUTLUCELL.VALIDITY, customId: String(appointment._id) });
            if (sendRes2 && !sendRes2.error && sendRes2.success !== false) {
              providerLog.status = 'sent'; providerLog.providerMessageId = sendRes2.providerMessageId || undefined; providerLog.sentAt = new Date();
            } else { providerLog.status = 'failed'; providerLog.error = (sendRes2 && sendRes2.error) ? sendRes2.error : 'SMS gönderimi başarısız'; }
            await providerLog.save();
          } catch (smsErr2) { }
        }
      }
    } catch (smsWrapErr) { }

    try {
      const planQuotaMapInc = { plus: 200, pro: 400, premium: null };
      let ownerDocForIncrement = null;
      if (user.userType === 'staff') {
        const bizDocForOwner2 = await Business.findById(user.businessId);
        if (bizDocForOwner2 && bizDocForOwner2.ownerId) ownerDocForIncrement = await User.findById(bizDocForOwner2.ownerId); else {
          const ownerCandidate2 = await User.findById(user.businessId);
          if (ownerCandidate2 && ownerCandidate2.userType === 'owner') ownerDocForIncrement = ownerCandidate2;
        }
      }
      const targetUser = ownerDocForIncrement || user;
      const effectiveMonthlyQuotaInc = planQuotaMapInc[targetUser.planType] ?? targetUser.monthlyQuota ?? null;
      const shouldIncrement = !!targetUser.isPremium && effectiveMonthlyQuotaInc != null && !appointment.isBlocked;
      if (shouldIncrement) {
        const now2 = new Date();
        await User.findByIdAndUpdate(targetUser._id, { $inc: { usedAppointmentsThisMonth: 1 }, lastResetAt: targetUser.lastResetAt || now2 });
      }
    } catch (incErr) { }

    return res.status(201).json({ message: 'Randevu başarıyla oluşturuldu', appointment });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function update(req, res) {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });

    let query = { _id: req.params.id, businessId: user.businessId };
    if (user.userType === 'staff') query.createdBy = user._id;

    const existing = await Appointment.findOne(query);
    if (!existing) return res.status(404).json({ error: 'Randevu bulunamadı veya yetkiniz yok' });

    try {
      const effectiveDate = req.body.date ? new Date(req.body.date) : new Date(existing.date);
      const pickTime = req.body.endTime || req.body.startTime || existing.endTime || existing.startTime || '23:59';
      const [hh, mm] = String(pickTime).split(':');
      const endDateTime = new Date(effectiveDate);
      endDateTime.setHours(Number(hh) || 23, Number(mm) || 59, 0, 0);
      if (endDateTime < new Date()) return res.status(400).json({ error: 'Geçmiş tarih/saat için randevu güncellenemez' });
    } catch (e) { return res.status(400).json({ error: 'Geçersiz tarih/saat formatı' }); }

    const isHalfHour = (t) => { if (!t) return true; const parts = String(t).split(':'); if (parts.length < 2) return false; const mins = Number(parts[1]); return mins === 0 || mins === 30; };
    if (typeof req.body.startTime !== 'undefined' && !isHalfHour(req.body.startTime)) return res.status(400).json({ error: 'Başlangıç saati 30 dakikalık adımlarda olmalıdır (örn. 08:00, 08:30).' });
    if (typeof req.body.endTime !== 'undefined' && !isHalfHour(req.body.endTime)) return res.status(400).json({ error: 'Bitiş saati 30 dakikalık adımlarda olmalıdır (örn. 08:00, 08:30).' });

    const appointment = await Appointment.findOneAndUpdate(query, req.body, { new: true });
    if (!appointment) return res.status(404).json({ error: 'Randevu bulunamadı veya yetkiniz yok' });

    try {
      const becameScheduled = typeof req.body.status !== 'undefined' && String(req.body.status) === 'scheduled' && String(existing.status) !== 'scheduled';
      if (becameScheduled && !appointment.isBlocked) {
        const businessDoc = await Business.findById(appointment.businessId);
        const businessName = businessDoc?.name || 'Mağaza';
        const addressText = businessDoc?.address || '';
        const formatDateTR = (d) => { const dd = d.getDate().toString().padStart(2, '0'); const mm = (d.getMonth() + 1).toString().padStart(2, '0'); const yyyy = d.getFullYear(); return `${dd}.${mm}.${yyyy}`; };
        const startDate = new Date(appointment.date);
        const startTimeStr = String(appointment.startTime || '').trim();
        const endTimeStr = String(appointment.endTime || '').trim();
        const customerName = String(appointment.clientName || '').trim();
        const customerPhone = String(appointment.clientPhone || '').trim();
        const serviceNameEffective = String(appointment.title || appointment.type || 'Hizmet').trim();
        const providerUserId = appointment.createdBy || appointment.userId;
        const providerUser = providerUserId ? await User.findById(providerUserId) : null;
        const providerMsisdn = normalizeMsisdn(providerUser?.phone || user.phone);
        const customerMsisdn = normalizeMsisdn(customerPhone);
        const customerMsg = `Randevunuz onaylandı: ${businessName} ${formatDateTR(startDate)} ${startTimeStr}-${endTimeStr}. ${addressText ? `Adres: ${addressText}` : ''}`.trim();
        const providerMsg = `Yeni randevu: ${customerName}, ${serviceNameEffective}, ${formatDateTR(startDate)} ${startTimeStr}-${endTimeStr}. Tel: ${customerPhone}`;
        if (customerMsisdn) {
          try {
            const customerLog = new SmsLog({ businessId: appointment.businessId, userId: providerUserId, appointmentId: appointment._id, msisdn: customerMsisdn, message: customerMsg, status: 'queued' });
            await customerLog.save();
            const sendRes = await sendSms({ dest: customerMsisdn, msg: customerMsg, originator: MUTLUCELL.ORIGINATOR, validFor: MUTLUCELL.VALIDITY, customId: String(appointment._id) });
            if (sendRes && !sendRes.error && sendRes.success !== false) { customerLog.status = 'sent'; customerLog.providerMessageId = sendRes.providerMessageId || undefined; customerLog.sentAt = new Date(); } else { customerLog.status = 'failed'; customerLog.error = (sendRes && sendRes.error) ? sendRes.error : 'SMS gönderimi başarısız'; }
            await customerLog.save();
          } catch (smsErr) { }
        }
        if (providerMsisdn) {
          try {
            const providerLog = new SmsLog({ businessId: appointment.businessId, userId: providerUserId, appointmentId: appointment._id, msisdn: providerMsisdn, message: providerMsg, status: 'queued' });
            await providerLog.save();
            const sendRes2 = await sendSms({ dest: providerMsisdn, msg: providerMsg, originator: MUTLUCELL.ORIGINATOR, validFor: MUTLUCELL.VALIDITY, customId: String(appointment._id) });
            if (sendRes2 && !sendRes2.error && sendRes2.success !== false) { providerLog.status = 'sent'; providerLog.providerMessageId = sendRes2.providerMessageId || undefined; providerLog.sentAt = new Date(); } else { providerLog.status = 'failed'; providerLog.error = (sendRes2 && sendRes2.error) ? sendRes2.error : 'SMS gönderimi başarısız'; }
            await providerLog.save();
          } catch (smsErr2) { }
        }
      }
    } catch (smsWrapErr) { }

    return res.json({ message: 'Randevu başarıyla güncellendi', appointment });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function remove(req, res) {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });

    let query = { _id: req.params.id, businessId: user.businessId };
    if (user.userType === 'staff') query.createdBy = user._id;

    const appointment = await Appointment.findOneAndDelete(query);
    if (!appointment) return res.status(404).json({ error: 'Randevu bulunamadı veya yetkiniz yok' });
    return res.json({ message: 'Randevu başarıyla silindi' });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function today(req, res) {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let query = { businessId: user.businessId, date: { $gte: today, $lt: tomorrow } };
    if (user.userType === 'staff') query.createdBy = user._id;

    let appointments = await Appointment.find(query).populate('createdBy', 'name email userType').sort({ startTime: 1 });
    appointments = await updateAppointmentStatuses(appointments);
    return res.json({ appointments });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
}

async function sendSmsGeneric(req, res) {
  try {
    const { to, message, appointmentId, sendAt, validFor, sourceAddr, datacoding } = req.body || {};
    if (!to || !message) return res.status(400).json({ error: 'Telefon numarası ve mesaj gereklidir' });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const msisdn = normalizeMsisdn(to);
    if (!msisdn || msisdn.length < 10) return res.status(400).json({ error: 'Geçersiz telefon numarası' });

    let log = new SmsLog({ businessId: user.businessId, userId: user._id, appointmentId: appointmentId || null, msisdn, message, status: 'queued', sentAt: new Date() });
    await log.save();

    const providerConfigured = (MUTLUCELL.USERNAME && MUTLUCELL.PASSWORD);
    const originator = (sourceAddr || MUTLUCELL.ORIGINATOR);
    const validForParam = (validFor || MUTLUCELL.VALIDITY);
    if (providerConfigured) {
      const result = await sendSms({ dest: msisdn, msg: message, originator, validFor: validForParam, sendAt, customId: appointmentId || undefined, datacoding });
      if (result.success) { log.status = 'sent'; log.providerMessageId = result.providerMessageId; log.deliveredAt = null; } else { log.status = 'failed'; log.error = result.error; }
      await log.save();
      return res.json({ success: result.success, logId: log._id, providerMessageId: log.providerMessageId, error: log.error });
    }

    return res.json({ success: true, logId: log._id, note: 'SMS provider configured değil; mesaj yalnızca loglandı.' });
  } catch (err) {
    return res.status(500).json({ error: 'SMS gönderilirken sunucu hatası' });
  }
}

async function addPayment(req, res) {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const appointmentId = req.params.id;
    const { amount, method, note, date } = req.body || {};
    if (!appointmentId) return res.status(400).json({ error: 'Randevu kimliği gereklidir' });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Geçerli bir ödeme tutarı gereklidir' });

    const paymentRecord = { amount: Number(amount), method: method || 'nakit', note: note || '', date: date ? new Date(date) : new Date(), recordedBy: user._id };
    const updated = await Appointment.findByIdAndUpdate(appointmentId, { $push: { payments: paymentRecord }, $set: { updatedAt: new Date() } }, { new: true }).populate('createdBy', 'name userType');
    return res.json({ appointment: updated });
  } catch (error) {
    return res.status(500).json({ error: 'Ödeme eklenirken sunucu hatası oluştu' });
  }
}

module.exports = { list, create, update, remove, today, sendSmsGeneric, addPayment };
