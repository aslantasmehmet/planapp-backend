const mongoose = require('mongoose');

const cashEntrySchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['income', 'expense'], required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, enum: ['nakit', 'kart'], default: 'nakit' },
  note: { type: String, default: '', trim: true },
  date: { type: Date, default: Date.now, index: true },
  status: { type: String, enum: ['Paid', 'Due', 'Overdue'], default: 'Paid', index: true },
  dueDate: { type: Date, required: false, index: true },
  paidAt: { type: Date, required: false },
  saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: false, index: true },
  installmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Installment', required: false, index: true }
}, { timestamps: true });

cashEntrySchema.index({ businessId: 1, type: 1, date: 1 });
cashEntrySchema.index({ businessId: 1, status: 1, dueDate: 1 });
cashEntrySchema.index({ businessId: 1, type: 1, saleId: 1 });
cashEntrySchema.index({ businessId: 1, type: 1, installmentId: 1 });

module.exports = mongoose.model('CashEntry', cashEntrySchema);
