const mongoose = require('mongoose');

const userFeatureSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: false, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    featureKey: { type: String, required: true, trim: true },
    status: { type: String, enum: ['approved', 'pending', 'revoked'], default: 'pending', index: true },
    isEnabled: { type: Boolean, default: false },
    limits: { type: Object, default: {} },
    validFrom: { type: Date, default: Date.now },
    validUntil: { type: Date, required: false },
    note: { type: String, default: '', trim: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    approvedAt: { type: Date, required: false }
  },
  { timestamps: true }
);

userFeatureSchema.index({ userId: 1, featureKey: 1 }, { unique: true });

module.exports = mongoose.model('UserFeature', userFeatureSchema);
