'use strict';

const mongoose = require('mongoose');

const CustomerNoteSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  title: { type: String, trim: true, default: '' },
  category: { type: String, trim: true, default: 'Genel' },
  tags: { type: [String], default: [] },
  pinned: { type: Boolean, default: false },
  note: { type: String, required: true, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

CustomerNoteSchema.index({ businessId: 1, customerId: 1, pinned: -1, createdAt: -1 });

module.exports = mongoose.model('CustomerNote', CustomerNoteSchema);
