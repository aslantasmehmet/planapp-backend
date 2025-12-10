const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Business = require('../models/Business');
const Appointment = require('../models/Appointment');
const Customer = require('../models/Customer');
const { authenticateToken } = require('../middlewares/auth');

// Müşterileri getir
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    const { staffId } = req.query;
    let effectiveBusinessId = user.businessId;
    if (!effectiveBusinessId && user.userType === 'owner') {
      const biz = await Business.findOne({ ownerId: user._id }).select('_id');
      if (biz) {
        effectiveBusinessId = biz._id;
        try { await User.findByIdAndUpdate(user._id, { businessId: biz._id }); } catch (e) {}
      }
    }
    if (!effectiveBusinessId && user.userType === 'staff') {
      const fallbackBiz = await Business.findOne({ ownerId: user.businessId }).select('_id');
      if (fallbackBiz) {
        effectiveBusinessId = fallbackBiz._id;
        try { await User.findByIdAndUpdate(user._id, { businessId: fallbackBiz._id }); } catch (e) {}
      }
    }

    if (!effectiveBusinessId) {
      return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    }

    let query = { businessId: effectiveBusinessId };
    if (user.userType === 'staff') {
      query.createdBy = user._id;
    } else if (staffId && staffId !== 'all') {
      const staff = await User.findOne({ _id: staffId, userType: 'staff', createdBy: user._id }).select('_id');
      if (!staff) {
        return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
      }
      query.createdBy = staff._id;
    }

    let customers = await Customer.find(query).sort({ createdAt: -1 });

    if ((!customers || customers.length === 0) && user.userType === 'owner') {
      const ownerCustomers = Array.isArray(user.customers) ? user.customers : [];
      const staffMembers = await User.find({ userType: 'staff', businessId: user.businessId }).select('customers _id');
      const allStaffCustomers = [];
      for (const s of staffMembers) {
        const list = Array.isArray(s.customers) ? s.customers : [];
        if (list.length > 0) allStaffCustomers.push(...list.map(c => ({ ...c, addedBy: s._id })));
      }
      const combined = [...ownerCustomers.map(c => ({ ...c, addedBy: user._id })), ...allStaffCustomers];
      const byPhone = new Map();
      for (const c of combined) {
        if (!c) continue;
        const key = c.phone || `${c.name}_${Math.random()}`;
        if (!byPhone.has(key)) byPhone.set(key, c);
      }
      const docs = [];
      for (const c of byPhone.values()) {
        if (!c || !c.name || !c.phone) continue;
        docs.push({
          name: String(c.name).trim(),
          phone: String(c.phone).trim(),
          email: c.email ? String(c.email).trim() : '',
          businessId: effectiveBusinessId,
          createdBy: c.addedBy || user._id,
          legacyId: c.id || (c._id && c._id.toString ? c._id.toString() : null),
          createdAt: new Date()
        });
      }
      if (docs.length > 0) {
        try {
          await Customer.insertMany(docs, { ordered: false });
        } catch (e) {}
        customers = await Customer.find(query).sort({ createdAt: -1 });
      }
    }

    if (Array.isArray(customers) && customers.length > 0) {
      if (user.userType === 'staff') {
        for (const customer of customers) {
          const nameQuery = customer.name ? { clientName: { $regex: new RegExp(customer.name, 'i') } } : null;
          const phoneQuery = customer.phone ? { clientPhone: customer.phone } : null;
          const matchQuery = [];
          if (nameQuery) matchQuery.push(nameQuery);
          if (phoneQuery) matchQuery.push(phoneQuery);
          if (matchQuery.length === 0) {
            customer.totalAppointments = 0;
            customer.lastVisit = null;
            continue;
          }
          const customerAppointments = await Appointment.find({ businessId: effectiveBusinessId, createdBy: user._id, $or: matchQuery }).sort({ date: -1, startTime: -1 });
          customer.totalAppointments = customerAppointments.length;
          customer.lastVisit = customerAppointments.length > 0 ? customerAppointments[0].date : null;
        }
      }
    }

    res.json({ customers });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Müşteri listesi kaydet
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { customers } = req.body;
    if (!Array.isArray(customers)) {
      return res.status(400).json({ error: 'Müşteriler array formatında olmalıdır' });
    }
    const actor = await User.findById(req.user.userId).select('businessId userType');
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    let effectiveBusinessId = actor.businessId;
    if (!effectiveBusinessId && actor.userType === 'owner') {
      const biz = await Business.findOne({ ownerId: actor._id }).select('_id');
      if (biz) {
        effectiveBusinessId = biz._id;
        try { await User.findByIdAndUpdate(actor._id, { businessId: biz._id }); } catch (e) {}
      }
    }
    if (!effectiveBusinessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const results = [];
    for (const c of customers) {
      if (!c || !c.name || !c.phone) continue;
      const data = {
        name: String(c.name).trim(),
        phone: String(c.phone).trim(),
        email: c.email ? String(c.email).trim() : '',
        businessId: effectiveBusinessId,
        createdBy: actor._id,
        legacyId: c.id || (c._id && c._id.toString ? c._id.toString() : null)
      };
      try {
        const updated = await Customer.findOneAndUpdate(
          { businessId: effectiveBusinessId, phone: data.phone },
          { $set: data },
          { upsert: true, new: true }
        );
        results.push(updated);
      } catch (e) {}
    }
    res.json({ message: 'Müşteriler başarıyla kaydedildi', customers: results });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Tek müşteri ekleme
router.post('/add', authenticateToken, async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Müşteri adı ve telefonu gereklidir' });
    }
    const currentUser = await User.findById(req.user.userId).select('businessId userType');
    if (!currentUser) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    let effectiveBusinessId = currentUser.businessId;
    if (!effectiveBusinessId && currentUser.userType === 'owner') {
      const biz = await Business.findOne({ ownerId: currentUser._id }).select('_id');
      if (biz) {
        effectiveBusinessId = biz._id;
        try { await User.findByIdAndUpdate(currentUser._id, { businessId: biz._id }); } catch (e) {}
      }
    }
    if (!effectiveBusinessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const dup = await Customer.findOne({ businessId: effectiveBusinessId, phone: String(phone).trim() });
    if (dup) return res.status(400).json({ error: 'Bu müşteri zaten mevcut' });
    const newCustomer = await Customer.create({
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: email ? String(email).trim() : '',
      businessId: effectiveBusinessId,
      createdBy: currentUser._id
    });
    res.json({ message: 'Müşteri başarıyla eklendi', customer: newCustomer });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Müşteri güncelleme
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Müşteri adı ve telefonu gereklidir' });
    }
    const actor = await User.findById(req.user.userId).select('businessId userType');
    if (!actor) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    let customer = null;
    if (id && id.match(/^[0-9a-fA-F]{24}$/)) {
      customer = await Customer.findById(id);
    }
    if (!customer) {
      customer = await Customer.findOne({ legacyId: id });
    }
    if (!customer) {
      return res.status(404).json({ error: 'Müşteri bulunamadı' });
    }
    const dup = await Customer.findOne({ businessId: customer.businessId, phone: String(phone).trim(), _id: { $ne: customer._id } });
    if (dup) {
      return res.status(400).json({ error: 'Bu isim veya telefon numarası başka bir müşteri tarafından kullanılıyor' });
    }
    customer.name = String(name).trim();
    customer.phone = String(phone).trim();
    customer.email = email ? String(email).trim() : '';
    customer.updatedAt = new Date();
    await customer.save();
    res.json({ message: 'Müşteri başarıyla güncellendi', customer });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Müşteri sil
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    let deleted = null;
    if (id && id.match(/^[0-9a-fA-F]{24}$/)) {
      deleted = await Customer.findByIdAndDelete(id);
    }
    if (!deleted) {
      const found = await Customer.findOne({ legacyId: id });
      if (found) deleted = await Customer.findByIdAndDelete(found._id);
    }
    if (!deleted) {
      return res.status(404).json({ error: 'Müşteri bulunamadı' });
    }
    res.json({ message: 'Müşteri başarıyla silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;
