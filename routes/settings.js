const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');
const GlobalSetting = require('../models/GlobalSetting');
const Business = require('../models/Business');
const User = require('../models/User');

async function getGeneralSettingsFromDb() {
  const keys = ['sms_cron_enabled', 'sms_cron_hour', 'sms_cron_minute'];
  const docs = await GlobalSetting.find({ businessId: null, settingKey: { $in: keys } }).lean();
  const map = Object.fromEntries(docs.map(d => [d.settingKey, d.settingValue]));
  const enabled = String(map.sms_cron_enabled ?? 'true').toLowerCase() === 'true' || map.sms_cron_enabled === true;
  const hour = Number(map.sms_cron_hour ?? 2) || 2;
  const minute = Number(map.sms_cron_minute ?? 0) || 0;
  return { enabled, hour, minute };
}

router.get('/general', authenticateToken, async (req, res) => {
  try {
    const settings = await getGeneralSettingsFromDb();
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/general', authenticateToken, async (req, res) => {
  try {
    const { enabled, hour, minute } = req.body;
    const updates = [
      { key: 'sms_cron_enabled', value: !!enabled },
      { key: 'sms_cron_hour', value: Number(hour) || 2 },
      { key: 'sms_cron_minute', value: Number(minute) || 0 },
    ];
    for (const u of updates) {
      await GlobalSetting.findOneAndUpdate(
        { businessId: null, settingKey: u.key },
        { settingValue: u.value },
        { upsert: true, new: true }
      );
    }
    const newSettings = await getGeneralSettingsFromDb();
    try {
      if (global && global.__sessionReminderScheduler && typeof global.__sessionReminderScheduler.reconfigure === 'function') {
        await global.__sessionReminderScheduler.reconfigure(newSettings);
      }
    } catch (_) {}
    res.json({ success: true, settings: newSettings });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;

