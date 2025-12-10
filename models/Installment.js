const mongoose = require('mongoose');

const installmentSchema = new mongoose.Schema({
  saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  number: { type: Number, required: true, min: 0 },
  dueDate: { type: Date },
  expectedAmount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['Due', 'Paid', 'Overdue'], default: 'Due' },
  paymentDate: { type: Date },
  amountPaid: { type: Number, default: 0, min: 0 },
  isDownPayment: { type: Boolean, default: false },
  notes: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, {
  timestamps: true
});

installmentSchema.index({ saleId: 1, number: 1 }, { unique: true });
installmentSchema.index({ saleId: 1, dueDate: 1 });
installmentSchema.index({ businessId: 1, saleId: 1 });

module.exports = mongoose.model('Installment', installmentSchema);
