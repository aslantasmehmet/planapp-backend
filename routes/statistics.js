const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/auth');

const Appointment = require('../models/Appointment');
const Business = require('../models/Business');
const BlockedTime = require('../models/BlockedTime');
const AppointmentRequest = require('../models/AppointmentRequest');
const ContactMessage = require('../models/ContactMessage');
const SmsLog = require('../models/SmsLog');
const User = require('../models/User');

// Basit istatistik özeti
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [users, businesses, appointments, blockedTimes, appointmentRequests, contactMessages, smsLogs] = await Promise.all([
      User.countDocuments({}),
      Business.countDocuments({}),
      Appointment.countDocuments({}),
      BlockedTime.countDocuments({}),
      AppointmentRequest.countDocuments({}),
      ContactMessage.countDocuments({}),
      SmsLog.countDocuments({}),
    ]);

    res.json({
      ok: true,
      data: {
        users,
        businesses,
        appointments,
        blockedTimes,
        appointmentRequests,
        contactMessages,
        smsLogs,
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Sunucu hatası' });
  }
});

module.exports = router;
