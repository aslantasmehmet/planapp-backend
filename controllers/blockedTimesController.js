const BlockedTime = require('../models/BlockedTime');

async function create(req, res) {
  try {
    const { date, startTime, endTime, reason } = req.body;
    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'Tarih, başlangıç ve bitiş saati gereklidir' });
    }
    const blockedTime = new BlockedTime({
      userId: req.user.userId,
      businessId: req.user.businessId,
      date,
      startTime,
      endTime,
      reason: reason || 'Müsait değil',
    });
    await blockedTime.save();
    return res.status(201).json(blockedTime);
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası', details: error.message });
  }
}

async function list(req, res) {
  try {
    const { date, userId } = req.query;
    const query = { businessId: req.user.businessId };
    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      query.date = { $gte: startDate, $lte: endDate };
    }
    if (userId) query.userId = userId;
    const blockedTimes = await BlockedTime.find(query).sort({ date: 1, startTime: 1 });
    return res.json(blockedTimes);
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası', details: error.message });
  }
}

async function remove(req, res) {
  try {
    const blockedTime = await BlockedTime.findById(req.params.id);
    if (!blockedTime) return res.status(404).json({ error: 'Müsait olmayan saat bulunamadı' });
    if (blockedTime.userId.toString() !== req.user.userId && blockedTime.businessId.toString() !== req.user.businessId) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
    }
    await BlockedTime.findByIdAndDelete(req.params.id);
    return res.json({ message: 'Müsait olmayan saat başarıyla silindi' });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası', details: error.message });
  }
}

module.exports = { create, list, remove };
