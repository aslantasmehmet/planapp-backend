const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  content: { type: String, default: '', trim: true },
  sessionsCount: { type: Number, default: 0, min: 0 },
  price: { type: Number, default: 0, min: 0 },
  serviceName: { type: String, required: true, trim: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

campaignSchema.index({ userId: 1, serviceName: 1, name: 1 }, { unique: true });
campaignSchema.index({ businessId: 1, serviceName: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);

