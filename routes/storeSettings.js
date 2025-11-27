const express = require('express');
const router = express.Router();

const User = require('../models/User');
const { authenticateToken } = require('../middlewares/auth');

// Mağaza ayarlarını getir
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || user.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri bu işlemi yapabilir' });
    }
    const storeSettings = user.storeSettings || {
      enabled: false,
      storeName: '',
      storeDescription: '',
      showServiceDurations: true,
      allowStaffSelection: true,
      allowAppointmentCancellation: true,
      notificationPhone: '',
      showPlanlyoLogo: true,
      enableChatAssistant: false,
      updatedAt: new Date()
    };
    res.json(storeSettings);
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mağaza ayarlarını kaydet
router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || user.userType !== 'owner') {
      return res.status(403).json({ error: 'Sadece işletme sahipleri bu işlemi yapabilir' });
    }
    const { enabled, storeName, storeDescription, showServiceDurations, allowStaffSelection, allowAppointmentCancellation, notificationPhone, showPlanlyoLogo, enableChatAssistant } = req.body;

    if (enabled && storeName) {
      const existingStore = await User.findOne({ 'storeSettings.enabled': true, 'storeSettings.storeName': storeName.trim(), _id: { $ne: user._id } });
      if (existingStore) {
        return res.status(400).json({ error: 'Bu mağaza adı zaten kullanılıyor' });
      }
    }
    user.storeSettings = {
      enabled: enabled || false,
      storeName: storeName ? storeName.trim() : '',
      storeDescription: storeDescription || '',
      showServiceDurations: showServiceDurations !== undefined ? showServiceDurations : true,
      allowStaffSelection: allowStaffSelection !== undefined ? allowStaffSelection : true,
      allowAppointmentCancellation: allowAppointmentCancellation !== undefined ? allowAppointmentCancellation : true,
      notificationPhone: notificationPhone || '',
      showPlanlyoLogo: showPlanlyoLogo !== undefined ? showPlanlyoLogo : true,
      enableChatAssistant: enableChatAssistant !== undefined ? enableChatAssistant : false,
      updatedAt: new Date()
    };
    await user.save();
    res.json({ message: 'Mağaza ayarları başarıyla güncellendi', storeSettings: user.storeSettings });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;
