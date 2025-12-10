const mongoose = require('mongoose');

const AppointmentRepeatSchema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true, index: true },
  isRepeat: { type: Boolean, default: false },
}, { timestamps: true });

AppointmentRepeatSchema.index({ appointmentId: 1 }, { unique: true });

module.exports = mongoose.model('AppointmentRepeat', AppointmentRepeatSchema);
