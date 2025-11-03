const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'İsim gereklidir'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'E-posta gereklidir'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Geçerli bir e-posta adresi girin']
  },
  phone: {
    type: String,
    required: [true, 'Telefon numarası gereklidir'],
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Şifre gereklidir'],
    minlength: 6
  },
  avatar: {
    type: String,
    default: null
  },
  userType: {
    type: String,
    enum: ['owner', 'staff'],
    default: 'owner',
    required: true
  },
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    required: function() {
      return this.userType === 'staff';
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return this.userType === 'staff';
    }
  },
  services: {
    type: [{
      id: {
        type: String,
        required: true
      },
      name: {
        type: String,
        required: true,
        trim: true
      },
      description: {
        type: String,
        default: '',
        trim: true
      },
      duration: {
        type: Number,
        default: 0,
        min: 0
      },
      price: {
        type: Number,
        default: 0,
        min: 0
      },
      images: {
        type: [String],
        default: [],
        validate: {
          validator: function(images) {
            return images.length <= 5;
          },
          message: 'Bir hizmet için maksimum 5 görsel eklenebilir'
        }
      },
      showInStore: {
        type: Boolean,
        default: true
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    default: []
  },
  messageTemplates: {
    type: [{
      id: String,
      name: String,
      content: String,
      createdAt: String
    }],
    default: []
  },
  customers: {
    type: [{
      id: String,
      name: String,
      phone: String,
      email: String,
      addedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      businessId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business'
      },
      createdAt: String
    }],
    default: []
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
  storeSettings: {
    enabled: {
      type: Boolean,
      default: false
    },
    storeName: {
      type: String,
      default: '',
      trim: true
    },
    storeDescription: {
      type: String,
      default: '',
      trim: true
    },
    showServiceDurations: {
      type: Boolean,
      default: true
    },
    allowStaffSelection: {
      type: Boolean,
      default: true
    },
    allowAppointmentCancellation: {
      type: Boolean,
      default: true
    },
    notificationPhone: {
      type: String,
      default: '',
      trim: true
    },
    showPlanlyoLogo: {
      type: Boolean,
      default: true
    },
    enableChatAssistant: {
      type: Boolean,
      default: false
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  }
}, {
  timestamps: true
});

// Şifreyi kaydetmeden önce hash'le
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Şifre karşılaştırma metodu
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};
module.exports = mongoose.model('User', userSchema);