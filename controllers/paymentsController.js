const User = require('../models/User');
const Business = require('../models/Business');
const Payment = require('../models/Payment');
const CashEntry = require('../models/CashEntry');
const Appointment = require('../models/Appointment');
const StaffCompensation = require('../models/StaffCompensation');
const StaffPayment = require('../models/StaffPayment');

async function resolveBusinessId(userId) {
  const actor = await User.findById(userId).select('businessId userType').lean();
  if (!actor) return null;
  let effectiveBusinessId = actor.businessId;
  if (!effectiveBusinessId && actor.userType === 'owner') {
    const biz = await Business.findOne({ ownerId: actor._id }).select('_id');
    if (biz) effectiveBusinessId = biz._id;
  }
  return effectiveBusinessId || null;
}

exports.getPaymentsByCustomer = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const { customerId } = req.params;
    const payments = await Payment.find({ businessId, customerId: String(customerId) })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const enriched = [];
    for (const p of payments) {
      let staffShare = 0;
      let businessShare = Number(p.amount) || 0;
      let compModel = '';
      let compFixedAmount = 0;
      let compPercentage = 0;
      let compSalaryAmount = 0;
      try {
        const m = String(p.note || '').match(/\[APPT:([^\]]+)\]/);
        const apptId = m && m[1] && m[1].match(/^[0-9a-fA-F]{24}$/) ? m[1] : null;
        if (apptId) {
          const appt = await Appointment.findById(apptId).select('createdBy').lean();
          const sid = appt?.createdBy;
          if (sid) {
            const staffUser = await User.findById(sid).select('userType').lean();
            if (staffUser && staffUser.userType === 'staff') {
              const comp = await StaffCompensation.findOne({ businessId, staffId: sid }).lean();
              if (comp) {
                compModel = comp.model || '';
                compFixedAmount = Number(comp.fixedAmount || 0) || 0;
                compPercentage = Number(comp.percentage || 0) || 0;
                compSalaryAmount = Number(comp.salaryAmount || 0) || 0;
                if (comp.model === 'fixed') {
                  staffShare = Math.max(0, compFixedAmount);
                  businessShare = Math.max(0, (Number(p.amount) || 0) - staffShare);
                } else if (comp.model === 'percentage') {
                  const base = ((Number(p.amount) || 0) * compPercentage) / 100;
                  staffShare = Math.max(0, Math.round(base * 100) / 100);
                  businessShare = Math.max(0, Math.round(((Number(p.amount) || 0) - staffShare) * 100) / 100);
                } else {
                  staffShare = 0;
                  businessShare = Number(p.amount) || 0;
                }
              }
            }
          }
        }
      } catch (_) {}
      enriched.push({
        ...p,
        staffShare,
        businessShare,
        compModel,
        compFixedAmount,
        compPercentage,
        compSalaryAmount
      });
    }

    return res.json({ payments: enriched });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.createPayment = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const { customerId, amount, method, note, date, saleId, installmentId } = req.body || {};
    if (!customerId) return res.status(400).json({ error: 'Müşteri bilgisi gerekli' });
    const amt = Number(amount) || 0;
    if (amt <= 0) return res.status(400).json({ error: 'Geçerli bir tutar girin' });

    // Tarih: 'YYYY-MM-DD' gelirse yerel saate göre saat/dakikayı koruyarak oluştur
    const now = new Date();
    let when = now;
    if (date) {
      const ds = String(date).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
        const [yy, mm, dd] = ds.split('-').map(n => parseInt(n, 10));
        when = new Date(yy, (mm - 1), dd, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      } else {
        const parsed = new Date(ds);
        if (!isNaN(parsed.getTime())) when = parsed;
      }
    }

    const doc = await Payment.create({
      businessId,
      createdBy: req.user.userId,
      customerId: String(customerId),
      amount: amt,
      method: ['nakit', 'kart', 'havale'].includes(String(method)) ? method : 'nakit',
      note: note ? String(note).trim() : '',
      date: when,
      status: 'Paid',
      saleId: saleId && String(saleId).match(/^[0-9a-fA-F]{24}$/) ? saleId : undefined,
      installmentId: installmentId && String(installmentId).match(/^[0-9a-fA-F]{24}$/) ? installmentId : undefined,
    });

    try {
      const mtd = String(method) === 'kart' ? 'kart' : 'nakit';
      const when = doc.date || new Date();
      let bizAmount = amt;
      let shares = null;
      const markerMatch = String(note || '').match(/\[APPT:([^\]]+)\]/);
      const apptKey = markerMatch ? markerMatch[1] : null;
      if (apptKey && apptKey.match(/^[0-9a-fA-F]{24}$/)) {
        try {
          const appt = await Appointment.findById(apptKey).select('createdBy clientName service date startTime time').lean();
          if (appt && appt.createdBy) {
            const staffUser = await User.findById(appt.createdBy).select('userType').lean();
            if (staffUser && staffUser.userType === 'staff') {
              const comp = await StaffCompensation.findOne({ businessId, staffId: appt.createdBy }).lean();
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
              bizAmount = businessShare;
              shares = { staffShare, businessShare, compModel, compFixedAmount, compPercentage, compSalaryAmount };
              if (compModel !== 'salary') {
                try {
                  const exists = await StaffPayment.findOne({ businessId, staffId: appt.createdBy, appointmentId: apptKey, amount: amt }).lean();
                  if (!exists) {
                    await StaffPayment.create({
                      businessId,
                      staffId: appt.createdBy,
                      paymentId: doc._id,
                      appointmentId: apptKey,
                      customerId: String(customerId),
                      clientName: appt.clientName || '',
                      service: appt.service || '',
                      date: when,
                      time: String(appt.startTime || appt.time || '').substring(0,5),
                      amount: amt,
                      method: mtd,
                      note: String(note || ''),
                      staffShare: shares.staffShare,
                      businessShare: shares.businessShare,
                      compModel: shares.compModel,
                      compFixedAmount: shares.compFixedAmount,
                      compPercentage: shares.compPercentage,
                      compSalaryAmount: shares.compSalaryAmount
                    });
                  }
                } catch (_) {}
              }
            }
          }
        } catch (_) {}
      }

      await CashEntry.create({
        businessId,
        createdBy: req.user.userId,
        type: 'income',
        amount: bizAmount,
        method: mtd,
        note: note ? String(note).trim() : 'Müşteri ödemesi',
        date: when,
        status: 'Paid',
        paidAt: when,
        paymentId: doc._id,
        saleId: doc.saleId,
        installmentId: doc.installmentId
      });
    } catch (_) {}

    return res.status(201).json({ success: true, payment: doc });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.updatePayment = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const { paymentId } = req.params;
    const payload = req.body || {};

    const payment = await Payment.findOne({ _id: paymentId, businessId });
    if (!payment) return res.status(404).json({ error: 'Ödeme bulunamadı' });

    if (payload.amount !== undefined) {
      const amt = Number(payload.amount) || 0;
      if (amt <= 0) return res.status(400).json({ error: 'Geçerli bir tutar girin' });
      payment.amount = amt;
    }
    if (payload.method && ['nakit', 'kart', 'havale'].includes(String(payload.method))) {
      payment.method = payload.method;
    }
    if (payload.note !== undefined) {
      payment.note = String(payload.note || '').trim();
    }
    if (payload.date !== undefined) {
      const now = new Date();
      let whenUpd = now;
      if (payload.date) {
        const ds = String(payload.date).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
          const [yy, mm, dd] = ds.split('-').map(n => parseInt(n, 10));
          whenUpd = new Date(yy, (mm - 1), dd, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
        } else {
          const parsed = new Date(ds);
          if (!isNaN(parsed.getTime())) whenUpd = parsed;
        }
      }
      payment.date = whenUpd;
    }

    await payment.save();
    return res.json({ success: true, payment });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.deletePayment = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const { paymentId } = req.params;
    const payment = await Payment.findOne({ _id: paymentId, businessId });
    if (!payment) return res.status(404).json({ error: 'Ödeme bulunamadı' });
    await Payment.deleteOne({ _id: paymentId });
    try {
      await CashEntry.deleteMany({ businessId, type: 'income', paymentId: payment._id });
      if (!payment.note && !payment.date) {
      } else {
        await CashEntry.deleteMany({ businessId, type: 'income', note: String(payment.note || ''), date: payment.date });
      }
      await StaffPayment.deleteMany({ businessId, paymentId: payment._id });
      try {
        const m = String(payment.note || '').match(/\[APPT:([^\]]+)\]/);
        const apptId = m && m[1] && m[1].match(/^[0-9a-fA-F]{24}$/) ? m[1] : null;
        if (apptId) {
          await StaffPayment.deleteMany({ businessId, appointmentId: apptId, amount: Number(payment.amount) || 0 });
        }
      } catch (_) {}
    } catch (_) {}
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};
