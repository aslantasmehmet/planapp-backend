const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const AppointmentRequest = require('../models/AppointmentRequest');
const Business = require('../models/Business');

// Genel randevu talebi oluştur
router.post('/api/appointment-requests', async (req, res) => {
  try {
    const { firstName, lastName, phone, serviceName, serviceId, storeName, notes } = req.body;
    if (!firstName || !lastName || !phone || !storeName) {
      return res.status(400).json({ error: 'Ad, soyad, telefon ve mağaza adı zorunludur' });
    }

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
      status: 'pending',
      ...(serviceId && mongoose.Types.ObjectId.isValid(serviceId) ? { serviceId } : {})
    });

    await appointmentRequest.save();
    res.status(201).json({ success: true, message: 'Randevu talebiniz başarıyla gönderildi', appointmentRequest });
  } catch (error) {
    res.status(500).json({ error: 'Randevu talebi oluşturulurken bir hata oluştu', details: error.message });
  }
});

// Randevu talebi durum güncelle
router.put('/api/appointment-requests/:requestId', async (req, res) => {
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

    const updated = await AppointmentRequest.findByIdAndUpdate(requestId, { status }, { new: true });
    if (!updated) return res.status(404).json({ error: 'Randevu talebi bulunamadı' });
    res.status(200).json({ success: true, appointmentRequest: updated });
  } catch (error) {
    res.status(500).json({ error: 'Randevu talebi güncellenirken bir hata oluştu', details: error.message });
  }
});

// Mağaza sahibi için randevu taleplerini getir
router.get('/api/appointment-requests/:storeOwnerId', async (req, res) => {
  try {
    const { storeOwnerId } = req.params;
    if (!storeOwnerId) return res.status(400).json({ error: 'Mağaza sahibi ID gerekli' });
    const orClauses = [
      { storeOwnerId },
      { storeOwnerId: new mongoose.Types.ObjectId(storeOwnerId) }
    ];
    const appointmentRequests = await AppointmentRequest.find({ $or: orClauses }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, appointmentRequests });
  } catch (error) {
    res.status(500).json({ error: 'Randevu talepleri getirilirken bir hata oluştu', details: error.message });
  }
});

module.exports = router;
