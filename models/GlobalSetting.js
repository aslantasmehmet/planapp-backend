const mongoose = require('mongoose');

const globalSettingSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: false },
  settingKey: { type: String, required: true, trim: true },
  settingValue: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

globalSettingSchema.index({ businessId: 1, settingKey: 1 }, { unique: true, partialFilterExpression: { settingKey: { $type: 'string' } } });

module.exports = mongoose.model('GlobalSetting', globalSettingSchema);

