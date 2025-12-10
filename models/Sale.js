const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema({
  customerId: { type: String, required: true, trim: true },
  campaignId: { type: String, required: true, trim: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  paymentType: { type: String, enum: ['Cash', 'Installment'], required: true },
  totalAmount: { type: Number, required: true, min: 0 },
  downPayment: { type: Number, default: 0, min: 0 },
  installmentsCount: { type: Number, default: 0, min: 0 },
  firstInstallmentDate: { type: Date, default: null },
  firstSessionDate: { type: Date, required: true },
  isNotificationRequested: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

saleSchema.index({ businessId: 1, customerId: 1, campaignId: 1 });

module.exports = mongoose.model('Sale', saleSchema);
