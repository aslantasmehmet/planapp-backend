const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const User = require('../models/User');
const Business = require('../models/Business');
const Customer = require('../models/Customer');
const Campaign = require('../models/Campaign');
const Installment = require('../models/Installment');
const SaleSession = require('../models/SaleSession');
const SmsLog = require('../models/SmsLog');
const CashEntry = require('../models/CashEntry');
const { sendSms } = require('../services/smsService');
const { MUTLUCELL } = require('../config');
const { normalizeMsisdn } = require('../utils/phone');

exports.createSale = async (req, res) => {
  try {
    const { customerId, campaignId, paymentType, downPayment, firstInstallmentDate, firstSessionDate, isNotificationRequested, installmentsCount } = req.body;
    if (!customerId || !campaignId || !paymentType || !firstSessionDate) {
      return res.status(400).json({ error: 'Zorunlu alanlar eksik' });
    }

    const actor = await User.findById(req.user.userId).select('userType businessId customers campaigns');
    if (!actor) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    let businessId = actor.businessId || null;
    if (!businessId && actor.userType === 'owner') {
      const biz = await Business.findOne({ ownerId: actor._id }).select('_id');
      businessId = biz ? biz._id : null;
    }
    const ownerIdLegacy = actor.userType === 'owner' ? actor._id : null;
    if (!businessId && ownerIdLegacy) {
      businessId = ownerIdLegacy;
    }
    if (!businessId) {
      return res.status(404).json({ error: 'İşletme bilgisi bulunamadı' });
    }

    const findCustomerInList = (list) => (list || []).find(c => {
      const cid = c._id?.toString?.() || c.id;
      return cid && cid.toString() === String(customerId);
    });
    let customer = findCustomerInList(actor.customers || []);
    if (!customer && actor.userType === 'owner') {
      const staffMembers = await User.find({ userType: 'staff', $or: [ { businessId }, { businessId: actor._id } ] }).select('customers');
      for (const s of staffMembers) {
        customer = findCustomerInList(s.customers || []);
        if (customer) break;
      }
    }
    if (!customer && actor.userType === 'staff') {
    let ownerDoc = null;
    try {
      const biz = await Business.findById(businessId).select('ownerId');
      if (biz && biz.ownerId) ownerDoc = await User.findById(biz.ownerId).select('customers');
    } catch (_) {}
      if (!ownerDoc) {
        try {
          const ownerCandidate = await User.findById(businessId).select('customers userType');
          if (ownerCandidate && ownerCandidate.userType === 'owner') ownerDoc = ownerCandidate;
        } catch (_) {}
      }
      customer = findCustomerInList(ownerDoc?.customers || []);
    }
    if (!customer && req.body.customerPhone) {
      const phone = String(req.body.customerPhone).trim();
      const findByPhone = (list) => (list || []).find(c => String(c.phone || '').trim() === phone);
      customer = findByPhone(actor.customers || []);
      if (!customer && actor.userType === 'owner') {
        const staffMembers = await User.find({ userType: 'staff', $or: [ { businessId }, { businessId: actor._id } ] }).select('customers');
        for (const s of staffMembers) {
          customer = findByPhone(s.customers || []);
          if (customer) break;
        }
      }
      if (!customer && actor.userType === 'staff') {
        let ownerDoc = null;
        try {
          const biz = await Business.findById(businessId).select('ownerId');
          if (biz && biz.ownerId) ownerDoc = await User.findById(biz.ownerId).select('customers');
        } catch (_) {}
        if (!ownerDoc) {
          try {
            const ownerCandidate = await User.findById(businessId).select('customers userType');
            if (ownerCandidate && ownerCandidate.userType === 'owner') ownerDoc = ownerCandidate;
          } catch (_) {}
        }
        customer = findByPhone(ownerDoc?.customers || []);
      }
    }
    if (!customer) {
      const bizIds = [];
      if (businessId) bizIds.push(businessId);
      bizIds.push(actor._id);
      try {
        const biz = await Business.findById(businessId).select('_id ownerId');
        if (biz && biz._id) bizIds.push(biz._id);
        if (biz && biz.ownerId) bizIds.push(biz.ownerId);
      } catch (_) {}

      let customerDoc = null;
      if (mongoose.Types.ObjectId.isValid(String(customerId))) {
        try {
          customerDoc = await Customer.findOne({ _id: customerId, businessId: { $in: bizIds } });
        } catch (_) {}
      }
      if (!customerDoc) {
        try {
          customerDoc = await Customer.findOne({ legacyId: String(customerId), businessId: { $in: bizIds } });
        } catch (_) {}
      }
      if (!customerDoc && req.body.customerPhone) {
        try {
          customerDoc = await Customer.findOne({ phone: String(req.body.customerPhone).trim(), businessId: { $in: bizIds } });
        } catch (_) {}
      }
      if (customerDoc) {
        customer = { id: customerDoc._id.toString(), name: customerDoc.name, phone: customerDoc.phone };
        req.body.customerId = customerDoc._id.toString();
      }
    }
    if (!customer) {
      return res.status(404).json({ error: 'Müşteri bulunamadı' });
    }

    const findCampaignInList = (list) => (list || []).find(c => {
      const id = c._id?.toString?.() || c.id;
      return id && id.toString() === String(campaignId);
    });
    let campaign = findCampaignInList(actor.campaigns || []);
    if (!campaign && actor.userType === 'staff') {
      let ownerDoc = null;
      try {
        const biz = await Business.findById(businessId).select('ownerId');
        if (biz && biz.ownerId) ownerDoc = await User.findById(biz.ownerId).select('campaigns');
      } catch (_) {}
      if (!ownerDoc) {
        try {
          const ownerCandidate = await User.findById(businessId).select('campaigns userType');
          if (ownerCandidate && ownerCandidate.userType === 'owner') ownerDoc = ownerCandidate;
        } catch (_) {}
      }
      campaign = findCampaignInList(ownerDoc?.campaigns || []);
    }
    if (!campaign && actor.userType === 'owner') {
      const staffMembers = await User.find({ userType: 'staff', $or: [ { businessId }, { businessId: actor._id } ] }).select('campaigns');
      for (const s of staffMembers) {
        campaign = findCampaignInList(s.campaigns || []);
        if (campaign) break;
      }
    }
    if (!campaign) {
      const bizIds = [];
      if (businessId) bizIds.push(businessId);
      bizIds.push(actor._id);
      try {
        const biz = await Business.findById(businessId).select('_id ownerId');
        if (biz && biz._id) bizIds.push(biz._id);
        if (biz && biz.ownerId) bizIds.push(biz.ownerId);
      } catch (_) {}
      if (mongoose.Types.ObjectId.isValid(String(campaignId))) {
        try {
          const item = await Campaign.findOne({ _id: campaignId, businessId: { $in: bizIds } });
          if (item) {
            campaign = { id: item._id.toString(), name: item.name, price: item.price, sessionsCount: item.sessionsCount, serviceName: item.serviceName };
          }
        } catch (_) {}
      }
    }
    if (!campaign) {
      return res.status(404).json({ error: 'Kampanya bulunamadı' });
    }

    const totalAmount = Number(campaign.price) || 0;
    let effectiveDownPayment = 0;
    let effectiveFirstInstallmentDate = null;

    if (paymentType === 'Cash') {
      effectiveDownPayment = totalAmount;
      effectiveFirstInstallmentDate = null;
    } else if (paymentType === 'Installment') {
      effectiveDownPayment = Number(downPayment) || 0;
      if (!firstInstallmentDate) {
        return res.status(400).json({ error: 'İlk taksit tarihi gerekli' });
      }
      effectiveFirstInstallmentDate = new Date(firstInstallmentDate);
      if (isNaN(effectiveFirstInstallmentDate.getTime())) {
        return res.status(400).json({ error: 'Geçersiz taksit tarihi' });
      }
      if (effectiveDownPayment < 0 || effectiveDownPayment > totalAmount) {
        return res.status(400).json({ error: 'Geçersiz peşinat tutarı' });
      }
    } else {
      return res.status(400).json({ error: 'Geçersiz ödeme türü' });
    }

    const firstSession = new Date(firstSessionDate);
    if (isNaN(firstSession.getTime())) {
      return res.status(400).json({ error: 'Geçersiz ilk seans tarihi' });
    }

    const sale = new Sale({
      customerId: String(customerId),
      campaignId: String(campaignId),
      businessId,
      createdBy: actor._id,
      paymentType,
      totalAmount,
      downPayment: effectiveDownPayment,
      installmentsCount: paymentType === 'Installment' ? (Number(installmentsCount) || 0) : 0,
      firstInstallmentDate: effectiveFirstInstallmentDate,
      firstSessionDate: firstSession,
      isNotificationRequested: !!isNotificationRequested
    });
    await sale.save();
    if (sale.downPayment && sale.downPayment > 0) {
      try {
        const dp = new Installment({
          saleId: sale._id,
          businessId: sale.businessId,
          number: 0,
          dueDate: sale.createdAt,
          expectedAmount: Number(sale.downPayment) || 0,
          status: 'Paid',
          paymentDate: new Date(),
          amountPaid: Number(sale.downPayment) || 0,
          isDownPayment: true,
          notes: 'Peşinat',
          createdBy: req.user.userId
        });
        await dp.save();
        try {
          const income = new CashEntry({
            businessId: sale.businessId,
            createdBy: req.user.userId,
            type: 'income',
            amount: Number(sale.downPayment) || 0,
            method: 'nakit',
            note: `Peşinat - Satış ${String(sale._id).slice(-6)}`,
            date: new Date(),
            status: 'Paid',
            paidAt: new Date(),
            saleId: sale._id,
            installmentId: dp._id
          });
          await income.save();
        } catch (_) {}
      } catch (_) {}
    }
    if (paymentType === 'Installment') {
      try {
        const remain = Math.max(0, (Number(sale.totalAmount) || 0) - (Number(sale.downPayment) || 0));
        const count = Math.max(0, Number(installmentsCount) || 0);
        if (remain > 0 && count > 0 && sale.firstInstallmentDate) {
          const per = remain / count;
          const createDocs = [];
          for (let i = 1; i <= count; i++) {
            const d = new Date(sale.firstInstallmentDate);
            d.setMonth(d.getMonth() + (i - 1));
            createDocs.push(new Installment({
              saleId: sale._id,
              businessId: sale.businessId,
              number: i,
              dueDate: d,
              expectedAmount: per,
              status: 'Due',
              isDownPayment: false,
              createdBy: req.user.userId
            }));
          }
          if (createDocs.length > 0) {
            await Installment.insertMany(createDocs);
          }
        }
      } catch (_) {}
    }
    return res.status(201).json({ success: true, message: 'Satış kaydedildi', sale });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.getSalesByCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const actor = await User.findById(req.user.userId).select('businessId userType');
    if (!actor) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const bizIds = [];
    if (actor.businessId) bizIds.push(actor.businessId);
    bizIds.push(actor._id);
    let ownerId = null;
    try {
      const biz = actor.businessId ? await Business.findById(actor.businessId).select('_id ownerId') : null;
      if (biz && biz._id) bizIds.push(biz._id);
      if (biz && biz.ownerId) ownerId = biz.ownerId;
    } catch (_) {}
    if (!ownerId && actor.userType === 'owner') {
      ownerId = actor._id;
    }

    const sales = await Sale.find({ businessId: { $in: bizIds }, customerId: String(id) }).sort({ createdAt: -1 }).lean();

    const campaignMap = new Map();
    const campaignInfoMap = new Map();
    try {
      const actorDoc = await User.findById(req.user.userId).select('campaigns').lean();
      (actorDoc?.campaigns || []).forEach(c => {
        const key = c._id?.toString?.() || c.id;
        if (key) {
          campaignMap.set(String(key), c.name || '');
          campaignInfoMap.set(String(key), { name: c.name || '', sessionsCount: Number(c.sessionsCount) || 0 });
        }
      });
    } catch (_) {}
    try {
      if (ownerId) {
        const ownerDoc = await User.findById(ownerId).select('campaigns').lean();
        (ownerDoc?.campaigns || []).forEach(c => {
          const key = c._id?.toString?.() || c.id;
          if (key && !campaignMap.has(String(key))) {
            campaignMap.set(String(key), c.name || '');
            campaignInfoMap.set(String(key), { name: c.name || '', sessionsCount: Number(c.sessionsCount) || 0 });
          }
        });
      }
    } catch (_) {}
    try {
      const staffUsers = await User.find({ userType: 'staff', businessId: { $in: [actor.businessId, ownerId].filter(Boolean) } }).select('campaigns').lean();
      staffUsers.forEach(u => {
        (u.campaigns || []).forEach(c => {
          const key = c._id?.toString?.() || c.id;
          if (key && !campaignMap.has(String(key))) {
            campaignMap.set(String(key), c.name || '');
            campaignInfoMap.set(String(key), { name: c.name || '', sessionsCount: Number(c.sessionsCount) || 0 });
          }
        });
      });
    } catch (_) {}

    const saleIds = sales.map(s => s._id).filter(Boolean);
    const completedBySale = new Map();
    try {
      const agg = await SaleSession.aggregate([
        { $match: { saleId: { $in: saleIds } } },
        { $group: { _id: '$saleId', completed: { $sum: { $cond: [{ $eq: ['$status', 'Completed'] }, 1, 0] } } } }
      ]);
      agg.forEach(row => {
        completedBySale.set(String(row._id), Number(row.completed) || 0);
      });
    } catch (_) {}

    const enriched = sales.map(s => ({
      ...s,
      campaignName: campaignMap.get(String(s.campaignId)) || '',
      sessionsTotal: (campaignInfoMap.get(String(s.campaignId))?.sessionsCount) || 0,
      sessionsCompleted: completedBySale.get(String(s._id)) || 0,
      sessionsRemaining: Math.max(0, ((campaignInfoMap.get(String(s.campaignId))?.sessionsCount) || 0) - (completedBySale.get(String(s._id)) || 0))
    }));

    return res.json({ sales: enriched });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.getSaleDetails = async (req, res) => {
  try {
    const { saleId } = req.params;
    const actor = await User.findById(req.user.userId).select('businessId userType').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const bizIds = [];
    if (actor.businessId) bizIds.push(actor.businessId);
    bizIds.push(actor._id);
    let ownerId = null;
    try {
      const biz = actor.businessId ? await Business.findById(actor.businessId).select('_id ownerId') : null;
      if (biz && biz._id) bizIds.push(biz._id);
      if (biz && biz.ownerId) ownerId = biz.ownerId;
    } catch (_) {}
    if (!ownerId && actor.userType === 'owner') ownerId = actor._id;

    const sale = await Sale.findOne({ _id: saleId, businessId: { $in: bizIds } }).lean();
    if (!sale) return res.status(404).json({ error: 'Satış bulunamadı' });

    let campaignName = '';
    let sessionsCount = 0;
    const ids = [sale.campaignId].filter(Boolean);
    const campaignMap = new Map();
    try {
      const actorDoc = await User.findById(req.user.userId).select('campaigns').lean();
      (actorDoc?.campaigns || []).forEach(c => {
        const key = c._id?.toString?.() || c.id;
        if (key) campaignMap.set(String(key), c);
      });
    } catch (_) {}
    try {
      if (ownerId) {
        const ownerDoc = await User.findById(ownerId).select('campaigns').lean();
        (ownerDoc?.campaigns || []).forEach(c => {
          const key = c._id?.toString?.() || c.id;
          if (key && !campaignMap.has(String(key))) campaignMap.set(String(key), c);
        });
      }
    } catch (_) {}
    const cam = campaignMap.get(String(sale.campaignId));
    if (cam) {
      campaignName = cam.name || '';
      sessionsCount = Number(cam.sessionsCount) || 0;
    } else {
      try {
        const item = await Campaign.findById(sale.campaignId).lean();
        if (item) {
          campaignName = item.name || '';
          sessionsCount = Number(item.sessionsCount) || 0;
        }
      } catch (_) {}
    }

    const installments = await Installment.find({ saleId: sale._id }).sort({ number: 1, dueDate: 1 }).lean();
    const plannedInstallments = installments.filter(it => !it.isDownPayment).length;
    const paidTotal = installments.reduce((sum, it) => sum + (Number(it.amountPaid) || 0), 0);
    const remainingDebt = Math.max(0, (Number(sale.totalAmount) || 0) - paidTotal);
    const sessions = await SaleSession.find({ saleId: sale._id }).sort({ sessionNumber: 1 }).lean();

    return res.json({
      sale: { ...sale, campaignName, sessionsCount, paidTotal, remainingDebt, installmentsCount: Math.max(Number(sale.installmentsCount || 0), plannedInstallments) },
      installments,
      sessions
    });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.updateSale = async (req, res) => {
  try {
    const { saleId } = req.params;
    const actor = await User.findById(req.user.userId).select('businessId userType').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const bizIds = [];
    if (actor.businessId) bizIds.push(actor.businessId);
    bizIds.push(actor._id);

    const sale = await Sale.findOne({ _id: saleId, businessId: { $in: bizIds } });
    if (!sale) return res.status(404).json({ error: 'Satış bulunamadı' });

    const { campaignId, paymentType, totalAmount, downPayment, firstInstallmentDate, firstSessionDate, isNotificationRequested, installmentsCount } = req.body || {};
    const previousPaymentType = sale.paymentType;

    // Apply basic updates
    if (campaignId !== undefined) sale.campaignId = String(campaignId);
    if (totalAmount !== undefined) sale.totalAmount = Number(totalAmount) || 0;
    if (firstSessionDate !== undefined) sale.firstSessionDate = firstSessionDate ? new Date(firstSessionDate) : sale.firstSessionDate;
    if (isNotificationRequested !== undefined) sale.isNotificationRequested = !!isNotificationRequested;

    // Handle payment type specific changes
    if (paymentType === 'Cash') {
      sale.paymentType = 'Cash';
      sale.installmentsCount = 0;
      sale.firstInstallmentDate = null;
      sale.downPayment = Number(sale.totalAmount) || 0;
    } else if (paymentType === 'Installment') {
      sale.paymentType = 'Installment';
      sale.installmentsCount = Math.max(0, Number(installmentsCount) || sale.installmentsCount || 0);
      sale.downPayment = Number(downPayment) || 0;
      if (!firstInstallmentDate) {
        return res.status(400).json({ error: 'İlk taksit tarihi gerekli' });
      }
      const fid = new Date(firstInstallmentDate);
      if (isNaN(fid.getTime())) {
        return res.status(400).json({ error: 'Geçersiz taksit tarihi' });
      }
      sale.firstInstallmentDate = fid;
      if (sale.downPayment < 0 || sale.downPayment > (Number(sale.totalAmount) || 0)) {
        return res.status(400).json({ error: 'Geçersiz peşinat tutarı' });
      }
    } else if (paymentType !== undefined) {
      return res.status(400).json({ error: 'Geçersiz ödeme türü' });
    }

    sale.updatedAt = new Date();
    await sale.save();

    // Rebuild installments when payment mode changes or relevant fields updated
    if (paymentType !== undefined || downPayment !== undefined || firstInstallmentDate !== undefined || installmentsCount !== undefined) {
      await Installment.deleteMany({ saleId: sale._id });
      if (sale.downPayment && sale.downPayment > 0) {
        try {
          const dp = new Installment({
            saleId: sale._id,
            businessId: sale.businessId,
            number: 0,
            dueDate: sale.updatedAt,
            expectedAmount: Number(sale.downPayment) || 0,
            status: 'Paid',
            paymentDate: new Date(),
            amountPaid: Number(sale.downPayment) || 0,
            isDownPayment: true,
            notes: 'Peşinat',
            createdBy: req.user.userId
          });
          await dp.save();
          try {
            const income = new CashEntry({
              businessId: sale.businessId,
              createdBy: req.user.userId,
              type: 'income',
              amount: Number(sale.downPayment) || 0,
              method: 'nakit',
              note: `Peşinat - Satış ${String(sale._id).slice(-6)}`,
              date: new Date(),
              status: 'Paid',
              paidAt: new Date(),
              saleId: sale._id,
              installmentId: dp._id
            });
            await income.save();
          } catch (_) {}
        } catch (_) {}
      }
      if (sale.paymentType === 'Installment') {
        try {
          const remain = Math.max(0, (Number(sale.totalAmount) || 0) - (Number(sale.downPayment) || 0));
          const count = Math.max(0, Number(sale.installmentsCount) || 0);
          if (remain > 0 && count > 0 && sale.firstInstallmentDate) {
            const per = remain / count;
            const createDocs = [];
            for (let i = 1; i <= count; i++) {
              const d = new Date(sale.firstInstallmentDate);
              d.setMonth(d.getMonth() + (i - 1));
              createDocs.push(new Installment({
                saleId: sale._id,
                businessId: sale.businessId,
                number: i,
                dueDate: d,
                expectedAmount: per,
                status: 'Due',
                isDownPayment: false,
                createdBy: req.user.userId
              }));
            }
            if (createDocs.length > 0) {
              await Installment.insertMany(createDocs);
            }
          }
        } catch (_) {}
      }
    }

    return res.json({ success: true, sale });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.deleteSale = async (req, res) => {
  try {
    const { saleId } = req.params;
    const actor = await User.findById(req.user.userId).select('businessId userType').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });

    const bizIds = [];
    if (actor.businessId) bizIds.push(actor.businessId);
    bizIds.push(actor._id);

    const sale = await Sale.findOne({ _id: saleId, businessId: { $in: bizIds } });
    if (!sale) return res.status(404).json({ error: 'Satış bulunamadı' });

    await Installment.deleteMany({ saleId: sale._id });
    await SaleSession.deleteMany({ saleId: sale._id });
    await CashEntry.deleteMany({ saleId: sale._id });
    await Sale.deleteOne({ _id: sale._id });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.getInstallments = async (req, res) => {
  try {
    const { saleId } = req.params;
    const actor = await User.findById(req.user.userId).select('businessId').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const sale = await Sale.findOne({ _id: saleId, businessId: { $in: [actor.businessId, actor._id].filter(Boolean) } }).lean();
    if (!sale) return res.status(404).json({ error: 'Satış bulunamadı' });
    const installments = await Installment.find({ saleId: sale._id }).sort({ number: 1, dueDate: 1 }).lean();
    const paidTotal = installments.reduce((sum, it) => sum + (Number(it.amountPaid) || 0), 0);
    const remainingDebt = Math.max(0, (Number(sale.totalAmount) || 0) - paidTotal);
    const plannedInstallments = installments.filter(it => !it.isDownPayment).length;
    return res.json({ installments, paidTotal, remainingDebt, installmentsCount: Math.max(Number(sale.installmentsCount || 0), plannedInstallments) });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.createInstallment = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { paymentDate, amountPaid, isDownPayment, notes } = req.body;
    const actor = await User.findById(req.user.userId).select('businessId').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const sale = await Sale.findOne({ _id: saleId, businessId: { $in: [actor.businessId, actor._id].filter(Boolean) } });
    if (!sale) return res.status(404).json({ error: 'Satış bulunamadı' });
    const doc = new Installment({
      saleId: sale._id,
      businessId: sale.businessId,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      amountPaid: Number(amountPaid) || 0,
      isDownPayment: !!isDownPayment,
      notes,
      createdBy: req.user.userId
    });
    await doc.save();
    return res.status(201).json({ success: true, installment: doc });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.updateInstallment = async (req, res) => {
  try {
    const { installmentId } = req.params;
    const { paymentDate, amountPaid, isDownPayment, notes, status } = req.body;
    const actor = await User.findById(req.user.userId).select('businessId').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const inst = await Installment.findById(installmentId);
    if (!inst) return res.status(404).json({ error: 'Taksit bulunamadı' });
    const sale = await Sale.findOne({ _id: inst.saleId, businessId: { $in: [actor.businessId, actor._id].filter(Boolean) } });
    if (!sale) return res.status(403).json({ error: 'Yetkisiz işlem' });
    const updates = {};
    if (paymentDate !== undefined) updates.paymentDate = paymentDate ? new Date(paymentDate) : new Date();
    if (amountPaid !== undefined) updates.amountPaid = Number(amountPaid) || 0;
    if (isDownPayment !== undefined) updates.isDownPayment = !!isDownPayment;
    if (notes !== undefined) updates.notes = notes;
    if (status) updates.status = status; else if (amountPaid && (Number(amountPaid) || 0) > 0) updates.status = 'Paid';
    Object.assign(inst, updates);
  await inst.save();
    try {
      if (inst.status === 'Paid') {
        const amount = Number(inst.amountPaid || inst.expectedAmount || 0);
        if (amount > 0) {
          const income = new CashEntry({
            businessId: sale.businessId,
            createdBy: req.user.userId,
            type: 'income',
            amount,
            method: 'nakit',
            note: `Taksit ödemesi - Satış ${String(sale._id).slice(-6)}`,
            date: new Date(inst.paymentDate || Date.now()),
            status: 'Paid',
            paidAt: new Date(inst.paymentDate || Date.now()),
            saleId: sale._id,
            installmentId: inst._id
          });
          await income.save();
        }
      }
    } catch (_) {}
  return res.json({ success: true, installment: inst });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};


exports.getSessions = async (req, res) => {
  try {
    const { saleId } = req.params;
    const actor = await User.findById(req.user.userId).select('businessId').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const sale = await Sale.findOne({ _id: saleId, businessId: { $in: [actor.businessId, actor._id].filter(Boolean) } }).lean();
    if (!sale) return res.status(404).json({ error: 'Satış bulunamadı' });
    const sessions = await SaleSession.find({ saleId: sale._id }).sort({ sessionNumber: 1 }).lean();
    return res.json({ sessions });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.initSessions = async (req, res) => {
  try {
    const { saleId } = req.params;
    const actor = await User.findById(req.user.userId).select('businessId').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const sale = await Sale.findOne({ _id: saleId, businessId: { $in: [actor.businessId, actor._id].filter(Boolean) } });
    if (!sale) return res.status(404).json({ error: 'Satış bulunamadı' });

    const existing = await SaleSession.countDocuments({ saleId: sale._id });
    if (existing > 0) return res.status(400).json({ error: 'Seanslar zaten oluşturulmuş' });

    let sessionsCount = 0;
    try {
      const cam = await Campaign.findById(sale.campaignId).lean();
      if (cam) sessionsCount = Number(cam.sessionsCount) || 0;
    } catch (_) {}
    if (sessionsCount <= 0) sessionsCount = 1;

    const docs = [];
    for (let i = 1; i <= sessionsCount; i++) {
      const scheduledDateTime = i === 1 && sale.firstSessionDate ? sale.firstSessionDate : undefined;
      docs.push(new SaleSession({
        saleId: sale._id,
        businessId: sale.businessId,
        sessionNumber: i,
        scheduledDateTime,
        status: scheduledDateTime ? 'Scheduled' : 'Pending',
        sendReminderSMS: !!sale.isNotificationRequested,
        createdBy: req.user.userId
      }));
    }
    await SaleSession.insertMany(docs);
    const sessions = await SaleSession.find({ saleId: sale._id }).sort({ sessionNumber: 1 }).lean();
    return res.status(201).json({ success: true, sessions });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.createSession = async (req, res) => {
  try {
    const { saleId } = req.params;
    const { sessionNumber, scheduledDateTime, status } = req.body;
    const actor = await User.findById(req.user.userId).select('businessId').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const sale = await Sale.findOne({ _id: saleId, businessId: { $in: [actor.businessId, actor._id].filter(Boolean) } });
    if (!sale) return res.status(404).json({ error: 'Satış bulunamadı' });
    const doc = new SaleSession({
      saleId: sale._id,
      businessId: sale.businessId,
      sessionNumber: Number(sessionNumber),
      scheduledDateTime: scheduledDateTime ? new Date(scheduledDateTime) : undefined,
      status: status || (scheduledDateTime ? 'Scheduled' : 'Pending'),
      createdBy: req.user.userId
    });
    await doc.save();
    return res.status(201).json({ success: true, session: doc });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.updateSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { status, scheduledDateTime, appointmentId, sendReminderSMS } = req.body;
    const actor = await User.findById(req.user.userId).select('businessId').lean();
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const sess = await SaleSession.findById(sessionId);
    if (!sess) return res.status(404).json({ error: 'Seans bulunamadı' });
    const sale = await Sale.findOne({ _id: sess.saleId, businessId: { $in: [actor.businessId, actor._id].filter(Boolean) } });
    if (!sale) return res.status(403).json({ error: 'Yetkisiz işlem' });
    const updates = {};
    if (status) updates.status = status;
    if (scheduledDateTime !== undefined) updates.scheduledDateTime = scheduledDateTime ? new Date(scheduledDateTime) : undefined;
    if (appointmentId !== undefined) updates.appointmentId = appointmentId;
    if (typeof sendReminderSMS !== 'undefined') updates.sendReminderSMS = !!sendReminderSMS;
    if (status === 'Completed' && !sess.completionDate) updates.completionDate = new Date();
    Object.assign(sess, updates);
    await sess.save();
    return res.json({ success: true, session: sess });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.runSessionReminders = async (req, res) => {
  try {
    const actor = await User.findById(req.user.userId).select('businessId');
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const targetDay = new Date();
    targetDay.setDate(targetDay.getDate() + 2);
    const startOfDay = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), 23, 59, 59, 999);
    const sessions = await SaleSession.find({
      businessId: { $in: [actor.businessId, actor._id].filter(Boolean) },
      sendReminderSMS: true,
      reminderSentDate: { $exists: false },
      status: 'Scheduled',
      scheduledDateTime: { $gte: startOfDay, $lte: endOfDay }
    }).lean();
    let sentCount = 0;
    for (const ss of sessions) {
      try {
        const sale = await Sale.findById(ss.saleId).lean();
        if (!sale) continue;
        let customerDoc = null;
        try { customerDoc = await Customer.findById(sale.customerId).lean(); } catch (_) {}
        if (!customerDoc) continue;
        const msisdn = normalizeMsisdn(customerDoc.phone);
        if (!msisdn) continue;
        const businessDoc = await Business.findById(sale.businessId).lean();
        const businessName = businessDoc?.name || 'Mağaza';
        const when = new Date(ss.scheduledDateTime);
        const dateStr = `${when.getDate().toString().padStart(2,'0')}.${(when.getMonth()+1).toString().padStart(2,'0')}.${when.getFullYear()}`;
        const timeStr = `${when.getHours().toString().padStart(2,'0')}:${when.getMinutes().toString().padStart(2,'0')}`;
        const msg = `Seansınız ${dateStr} ${timeStr} tarihinde. ${businessName}`;
        const log = new SmsLog({ businessId: sale.businessId, userId: req.user.userId, msisdn, message: msg, status: 'queued' });
        await log.save();
        const resSend = await sendSms({ dest: msisdn, msg, originator: MUTLUCELL.ORIGINATOR, validFor: MUTLUCELL.VALIDITY, customId: String(ss._id) });
        if (resSend && !resSend.error && resSend.success !== false) {
          await SmsLog.findByIdAndUpdate(log._id, { status: 'sent', providerMessageId: resSend.providerMessageId || undefined, sentAt: new Date() });
          await SaleSession.findByIdAndUpdate(ss._id, { reminderSentDate: new Date() });
          sentCount += 1;
        } else {
          await SmsLog.findByIdAndUpdate(log._id, { status: 'failed', error: (resSend && resSend.error) ? resSend.error : 'SMS gönderimi başarısız' });
        }
      } catch (_) {}
    }
    return res.json({ success: true, processed: sessions.length, sent: sentCount });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};
