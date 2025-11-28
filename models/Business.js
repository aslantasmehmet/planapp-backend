const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'İşletme adı gereklidir'],
    trim: true
  },
  address: {
    type: String,
    required: [true, 'Adres gereklidir'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Telefon numarası gereklidir'],
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  businessType: {
    type: String,
    required: [true, 'İşletme türü gereklidir'],
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  logo: {
    type: String,
    trim: true
  },
  images: {
    type: [String],
    default: [],
    validate: {
      validator: function(images) {
        return images.length <= 5;
      },
      message: 'Bir işletme için maksimum 5 görsel eklenebilir'
    }
  },
  workingHours: {
    monday: { start: String, end: String, isClosed: { type: Boolean, default: false } },
    tuesday: { start: String, end: String, isClosed: { type: Boolean, default: false } },
    wednesday: { start: String, end: String, isClosed: { type: Boolean, default: false } },
    thursday: { start: String, end: String, isClosed: { type: Boolean, default: false } },
    friday: { start: String, end: String, isClosed: { type: Boolean, default: false } },
    saturday: { start: String, end: String, isClosed: { type: Boolean, default: false } },
    sunday: { start: String, end: String, isClosed: { type: Boolean, default: false } }
  },
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  locationLat: {
    type: Number
  },
  locationLon: {
    type: Number
  },
  locationVerified: {
    type: Boolean,
    default: false
  },
  locationMethod: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Business', businessSchema);
