const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middlewares/auth');
const User = require('../models/User');
const Business = require('../models/Business');
const CashEntry = require('../models/CashEntry');

async function resolveBusinessId(userId) {
  const actor = await User.findById(userId).select('userType businessId createdBy');
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

router.get('/', authenticateToken, async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });

    const { type, month, status } = req.query;
    const query = { businessId };
    if (type && ['income', 'expense'].includes(type)) query.type = type;
    if (status && ['Paid', 'Due', 'Overdue'].includes(status)) query.status = status;

    if (month && /^\d{4}-\d{2}$/.test(String(month))) {
      const [y, m] = String(month).split('-').map(n => parseInt(n, 10));
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 1);
      if (query.status === 'Due' || query.status === 'Overdue') {
        query.dueDate = { $gte: start, $lt: end };
      } else {
        query.date = { $gte: start, $lt: end };
      }
    }

    const sort = (query.status === 'Due' || query.status === 'Overdue') ? { dueDate: 1, createdAt: -1 } : { date: -1, createdAt: -1 };
    const items = await CashEntry.find(query).sort(sort).lean();
    res.json({ items });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });

    const { type, amount, method, note, date, dueDate, status } = req.body || {};
    if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Geçersiz tür' });
    const amt = Number(amount);
    if (!amt || isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Geçersiz tutar' });
    const mtd = method === 'kart' ? 'kart' : 'nakit';
    const when = date ? new Date(date) : new Date();
    let st = status;
    let dd = null;
    let paidAt = null;
    if (type === 'expense' && dueDate) {
      dd = new Date(dueDate);
      const now = new Date();
      st = st && ['Paid','Due','Overdue'].includes(st) ? st : (dd > now ? 'Due' : 'Overdue');
    } else {
      st = 'Paid';
      paidAt = when;
    }
    if (type === 'income') {
      st = 'Paid';
      paidAt = when;
      dd = null;
    }

    const entry = await CashEntry.create({
      businessId,
      createdBy: req.user.userId,
      type,
      amount: amt,
      method: mtd,
      note: note || '',
      date: when,
      status: st,
      dueDate: dd,
      paidAt
    });

    res.json({ success: true, item: entry });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Sync income entries from sales installments
router.post('/sync/income', authenticateToken, async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });

    const { month } = req.body || {};
    let range = null;
    if (month && /^\d{4}-\d{2}$/.test(String(month))) {
      const [y, m] = String(month).split('-').map(n => parseInt(n, 10));
      range = { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
    }

    const Installment = require('../models/Installment');
    const Sale = require('../models/Sale');

    const instQuery = { businessId, status: 'Paid' };
    if (range) instQuery.paymentDate = { $gte: range.start, $lt: range.end };
    const paidInst = await Installment.find(instQuery).lean();

    const existingByInst = new Set();
    try {
      const existing = await CashEntry.find({ businessId, type: 'income', installmentId: { $in: paidInst.map(p => p._id) } }).select('installmentId').lean();
      existing.forEach(e => { if (e.installmentId) existingByInst.add(String(e.installmentId)); });
    } catch (_) {}

    let createdCount = 0;
    for (const inst of paidInst) {
      if (existingByInst.has(String(inst._id))) continue;
      const sale = await Sale.findById(inst.saleId).select('_id businessId').lean();
      const amount = Number(inst.amountPaid || inst.expectedAmount || 0);
      if (!amount || amount <= 0) continue;
      const when = inst.paymentDate ? new Date(inst.paymentDate) : new Date();
      await CashEntry.create({
        businessId,
        createdBy: req.user.userId,
        type: 'income',
        amount,
        method: 'nakit',
        note: `Ödeme - Satış ${String(sale?._id || inst.saleId || '').toString().slice(-6)}`,
        date: when,
        status: 'Paid',
        paidAt: when,
        saleId: sale?._id || inst.saleId,
        installmentId: inst._id
      });
      createdCount++;
    }

    return res.json({ success: true, created: createdCount });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;

// Update cash entry status or fields
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });

    const { id } = req.params;
    const payload = req.body || {};

    const entry = await CashEntry.findOne({ _id: id, businessId });
    if (!entry) return res.status(404).json({ error: 'Kayıt bulunamadı' });

    const updates = {};
    if (typeof payload.note === 'string') updates.note = payload.note;
    if (payload.method && ['nakit','kart'].includes(payload.method)) updates.method = payload.method;
    if (payload.status && ['Paid','Due','Overdue'].includes(payload.status)) {
      updates.status = payload.status;
      if (payload.status === 'Paid') {
        const now = new Date();
        updates.paidAt = payload.paidAt ? new Date(payload.paidAt) : now;
        updates.date = payload.date ? new Date(payload.date) : now;
        updates.dueDate = null;
      }
    }
    if (payload.dueDate) {
      updates.dueDate = new Date(payload.dueDate);
      const now = new Date();
      if (!updates.status) updates.status = updates.dueDate > now ? 'Due' : 'Overdue';
    }

    await CashEntry.updateOne({ _id: id }, { $set: updates });
    const updated = await CashEntry.findById(id).lean();
    res.json({ success: true, item: updated });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});
