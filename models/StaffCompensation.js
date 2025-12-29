const mongoose = require('mongoose');

const staffCompensationSchema = new mongoose.Schema(
  {
    businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    model: { type: String, enum: ['salary', 'fixed', 'percentage'], default: 'salary' },
    salaryAmount: { type: Number, default: 0, min: 0 },
    fixedAmount: { type: Number, default: 0, min: 0 },
    percentage: { type: Number, default: 0, min: 0, max: 100 },
    payday: { type: Number, default: 1, min: 1, max: 31 },
    updatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

staffCompensationSchema.index({ businessId: 1, staffId: 1 }, { unique: true });

module.exports = mongoose.model('StaffCompensation', staffCompensationSchema);

