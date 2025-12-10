const mongoose = require('mongoose');

const saleSessionSchema = new mongoose.Schema({
  saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  sessionNumber: { type: Number, required: true, min: 1 },
  scheduledDateTime: { type: Date, required: false },
  status: { type: String, enum: ['Pending', 'Scheduled', 'Completed', 'Cancelled'], default: 'Pending' },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: false },
  completionDate: { type: Date, required: false },
  sendReminderSMS: { type: Boolean, default: false },
  reminderSentDate: { type: Date, required: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, {
  timestamps: true
});

saleSessionSchema.index({ saleId: 1, sessionNumber: 1 }, { unique: true });
saleSessionSchema.index({ businessId: 1, saleId: 1 });

module.exports = mongoose.model('SaleSession', saleSessionSchema);
