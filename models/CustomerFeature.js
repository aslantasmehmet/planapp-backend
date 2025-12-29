const mongoose = require('mongoose');

const customerFeatureSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerId: { type: String, required: true, trim: true, index: true },
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

customerFeatureSchema.index({ businessId: 1, customerId: 1, featureKey: 1 }, { unique: true });

module.exports = mongoose.model('CustomerFeature', customerFeatureSchema);
