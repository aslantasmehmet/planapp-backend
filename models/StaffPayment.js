const mongoose = require('mongoose');

const staffPaymentSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: false, index: true },
    appointmentId: { type: String, default: '' },
    customerId: { type: String, default: '' },
    clientName: { type: String, default: '' },
    service: { type: String, default: '' },
    date: { type: Date, default: Date.now, index: true },
    time: { type: String, default: '' },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['nakit', 'kart', 'havale'], default: 'nakit' },
    note: { type: String, default: '' },
    staffShare: { type: Number, default: 0, min: 0 },
    businessShare: { type: Number, default: 0, min: 0 },
    compModel: { type: String, default: '' },
    compFixedAmount: { type: Number, default: 0 },
    compPercentage: { type: Number, default: 0 },
    compSalaryAmount: { type: Number, default: 0 },
    isSalary: { type: Boolean, default: false, index: true },
    salaryMonth: { type: String, default: '' },
    status: { type: String, enum: ['Paid', 'Pending'], default: 'Paid', index: true }
  },
  { timestamps: true }
);

staffPaymentSchema.index({ businessId: 1, staffId: 1, date: 1 });
staffPaymentSchema.index({ businessId: 1, staffId: 1, paymentId: 1 });
staffPaymentSchema.index({ businessId: 1, staffId: 1, isSalary: 1, salaryMonth: 1 });

module.exports = mongoose.model('StaffPayment', staffPaymentSchema);
