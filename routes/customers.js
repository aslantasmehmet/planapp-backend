const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Business = require('../models/Business');
const Appointment = require('../models/Appointment');
const { authenticateToken } = require('../middlewares/auth');

// Müşterileri getir
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    let customers = [];
    const { staffId } = req.query;

    if (user.userType === 'owner') {
      if (staffId && staffId !== 'all') {
        const staff = await User.findOne({ _id: staffId, userType: 'staff', createdBy: user._id }).select('customers name');
        if (!staff) {
          return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
        }
        customers = staff.customers || [];
      } else {
        const ownerCustomers = user.customers || [];
        const staffMembers = await User.find({ userType: 'staff', businessId: user._id }).select('customers');
        const allStaffCustomers = [];
        staffMembers.forEach(staff => {
          if (staff.customers && staff.customers.length > 0) {
            allStaffCustomers.push(...staff.customers);
          }
        });
        const allCustomers = [...ownerCustomers, ...allStaffCustomers];
        const uniqueCustomers = allCustomers.filter((customer, index, self) => index === self.findIndex(c => c.phone && customer.phone && c.phone === customer.phone));
        customers = uniqueCustomers;
      }
    } else {
      customers = user.customers || [];
      for (let customer of customers) {
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
        const customerAppointments = await Appointment.find({ businessId: user.businessId, createdBy: user._id, $or: matchQuery }).sort({ date: -1, startTime: -1 });
        customer.totalAppointments = customerAppointments.length;
        customer.lastVisit = customerAppointments.length > 0 ? customerAppointments[0].date : null;
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
    await User.findByIdAndUpdate(req.user.userId, { customers: customers }, { new: true });
    res.json({ message: 'Müşteriler başarıyla kaydedildi', customers });
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
    const currentUser = await User.findById(req.user.userId).select('customers businessId userType');
    const customers = currentUser?.customers || [];
    const existingCustomer = customers.find(c => c.name.toLowerCase() === name.toLowerCase() || (phone && c.phone === phone));
    if (existingCustomer) {
      return res.status(400).json({ error: 'Bu müşteri zaten mevcut' });
    }
    let effectiveBusinessId = currentUser.businessId;
    if (!effectiveBusinessId) {
      if (currentUser.userType === 'owner') {
        const biz = await Business.findOne({ ownerId: currentUser._id });
        if (biz) {
          effectiveBusinessId = biz._id;
          try { await User.findByIdAndUpdate(currentUser._id, { businessId: biz._id }); } catch (e) {}
        }
      }
    }
    const newCustomer = { id: Date.now().toString(), name: name.trim(), phone: phone.trim(), email: email ? email.trim() : '', addedBy: req.user.userId, businessId: effectiveBusinessId, createdAt: new Date().toISOString() };
    const updatedCustomers = [...customers, newCustomer];
    await User.findByIdAndUpdate(req.user.userId, { customers: updatedCustomers }, { new: true });
    if (currentUser.userType === 'staff' && currentUser.businessId) {
      const biz = await Business.findById(currentUser.businessId).select('ownerId');
      const ownerId = biz?.ownerId;
      const owner = ownerId ? await User.findById(ownerId).select('customers') : null;
      const ownerCustomers = owner?.customers || [];
      const existingInOwner = ownerCustomers.find(c => c.name.toLowerCase() === name.toLowerCase() || (phone && c.phone === phone));
      if (!existingInOwner && ownerId) {
        const ownerUpdatedCustomers = [...ownerCustomers, newCustomer];
        await User.findByIdAndUpdate(ownerId, { customers: ownerUpdatedCustomers }, { new: true });
      }
    }
    res.json({ message: 'Müşteri başarıyla eklendi', customer: newCustomer, customers: updatedCustomers });
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
    const actor = await User.findById(req.user.userId).select('customers userType businessId');
    if (!actor) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    const findIndexInList = (list, targetId) => (list || []).findIndex(c => c.id === targetId || (c._id && c._id.toString() === targetId));
    const buildUpdatedCustomer = (prev) => ({ ...prev, name: name.trim(), phone: phone.trim(), email: email ? email.trim() : '', updatedAt: new Date().toISOString() });

    if (actor.userType === 'staff') {
      const customers = actor.customers || [];
      const customerIndex = findIndexInList(customers, id);
      if (customerIndex === -1) {
        return res.status(404).json({ error: 'Müşteri bulunamadı' });
      }
      const duplicate = customers.find((c, idx) => idx !== customerIndex && (c.phone && c.phone === phone));
      if (duplicate) {
        return res.status(400).json({ error: 'Bu isim veya telefon numarası başka bir müşteri tarafından kullanılıyor' });
      }
      customers[customerIndex] = buildUpdatedCustomer(customers[customerIndex]);
      await User.findByIdAndUpdate(actor._id, { customers }, { new: true });
      return res.json({ message: 'Müşteri başarıyla güncellendi', customer: customers[customerIndex], customers });
    }

    let ownerCustomers = actor.customers || [];
    let customerIndex = findIndexInList(ownerCustomers, id);
    if (customerIndex !== -1) {
      const duplicate = ownerCustomers.find((c, idx) => idx !== customerIndex && (c.phone && c.phone === phone));
      if (duplicate) {
        return res.status(400).json({ error: 'Bu isim veya telefon numarası başka bir müşteri tarafından kullanılıyor' });
      }
      ownerCustomers[customerIndex] = buildUpdatedCustomer(ownerCustomers[customerIndex]);
      await User.findByIdAndUpdate(actor._id, { customers: ownerCustomers }, { new: true });
      return res.json({ message: 'Müşteri başarıyla güncellendi', customer: ownerCustomers[customerIndex], customers: ownerCustomers });
    }

    let ownerBusinessId = actor.businessId;
    if (!ownerBusinessId) {
      const biz = await Business.findOne({ ownerId: actor._id }).select('_id');
      if (biz) {
        ownerBusinessId = biz._id;
        try { await User.findByIdAndUpdate(actor._id, { businessId: biz._id }); } catch (e) {}
      }
    }
    if (!ownerBusinessId) {
      return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    }
    const staffMembers = await User.find({ userType: 'staff', businessId: ownerBusinessId }).select('customers');
    for (const staff of staffMembers) {
      const list = staff.customers || [];
      const idx = findIndexInList(list, id);
      if (idx !== -1) {
        const duplicate = list.find((c, j) => j !== idx && (c.phone && c.phone === phone));
        if (duplicate) {
          return res.status(400).json({ error: 'Bu isim veya telefon numarası başka bir müşteri tarafından kullanılıyor' });
        }
        list[idx] = buildUpdatedCustomer(list[idx]);
        await User.findByIdAndUpdate(staff._id, { customers: list }, { new: true });
        return res.json({ message: 'Müşteri başarıyla güncellendi', customer: list[idx], customers: list });
      }
    }
    return res.status(404).json({ error: 'Müşteri bulunamadı' });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Müşteri sil
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(req.user.userId).select('customers');
    const customers = user?.customers || [];
    const customerIndex = customers.findIndex(c => c.id === id || c._id === id || (c._id?.toString && c._id?.toString() === id));
    if (customerIndex === -1) {
      return res.status(404).json({ error: 'Müşteri bulunamadı' });
    }
    const deletedCustomer = customers.splice(customerIndex, 1)[0];
    await User.findByIdAndUpdate(req.user.userId, { customers: customers }, { new: true });
    res.json({ message: 'Müşteri başarıyla silindi', deletedCustomer, customers });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;
