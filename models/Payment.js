const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customerId: { type: String, required: true, trim: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['nakit', 'kart', 'havale'], default: 'nakit' },
    note: { type: String, default: '', trim: true },
    date: { type: Date, default: Date.now, index: true },
    status: { type: String, enum: ['Paid'], default: 'Paid', index: true },
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: false },
    installmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Installment', required: false }
  },
  { timestamps: true }
);

paymentSchema.index({ businessId: 1, customerId: 1, date: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
