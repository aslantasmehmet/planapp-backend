const mongoose = require('mongoose');

const OtpCodeSchema = new mongoose.Schema(
  {
    // Login için user dolu olur; kayıt için null olabilir
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    phone: { type: String, required: true },
    code: { type: String, required: true },
    status: { type: String, enum: ['pending', 'verified', 'expired'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    // Akış bilgisi: login veya register
    purpose: { type: String, enum: ['login', 'register'], default: 'login' },
    // Register için gerekli geçici payload (ad, e-posta, rawPhone, şifre vb.)
    payload: {
      type: Object,
      required: false,
      default: null,
    },
  },
  { timestamps: true }
);

// Remove documents after expiresAt has passed
OtpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OtpCode', OtpCodeSchema);