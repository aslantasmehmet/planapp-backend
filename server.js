const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Appointment = require('./models/Appointment');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// MongoDB bağlantısı
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB bağlantısı başarılı'))
  .catch(err => console.error('MongoDB bağlantı hatası:', err));

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// JWT doğrulama middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token gerekli' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Geçersiz token' });
    }
    req.user = user;
    next();
  });
};

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server çalışıyor' });
});

// Kayıt olma
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, usageType, companyName, authorizedPerson } = req.body;

    // Validasyon
    if (!email || !password || !name || !usageType) {
      return res.status(400).json({ error: 'Tüm alanlar gereklidir' });
    }

    // İş yeri seçimi için ek validasyon
    if (usageType === 'business' && (!companyName || !authorizedPerson)) {
      return res.status(400).json({ error: 'İş yeri kullanımı için şirket adı ve yetkili kişi bilgisi gereklidir' });
    }

    // Kullanıcı zaten var mı kontrol et
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu email ile zaten bir hesap var' });
    }

    // Yeni kullanıcı oluştur
    const userData = { name, email, password, usageType };
    if (usageType === 'business') {
      userData.companyName = companyName;
      userData.authorizedPerson = authorizedPerson;
    }
    
    const user = new User(userData);
    await user.save();

    // JWT token oluştur
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Kullanıcı başarıyla oluşturuldu',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        usageType: user.usageType,
        companyName: user.companyName,
        authorizedPerson: user.authorizedPerson
      }
    });
  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Giriş yapma
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validasyon
    if (!email || !password) {
      return res.status(400).json({ error: 'Email ve şifre gereklidir' });
    }

    // Kullanıcıyı bul
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Geçersiz email veya şifre' });
    }

    // Şifreyi kontrol et
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Geçersiz email veya şifre' });
    }

    // JWT token oluştur
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Giriş başarılı',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        usageType: user.usageType,
        companyName: user.companyName,
        authorizedPerson: user.authorizedPerson
      }
    });
  } catch (error) {
    console.error('Giriş hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Kullanıcı profili
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Profil hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Korumalı planlar endpoint'i
app.get('/api/plans', authenticateToken, (req, res) => {
  res.json({
    message: 'Planlar başarıyla alındı',
    plans: ['Plan 1', 'Plan 2', 'Plan 3']
  });
});

// RANDEVU ENDPOINT'LERİ

// Tüm randevuları getir
app.get('/api/appointments', authenticateToken, async (req, res) => {
  try {
    const appointments = await Appointment.find({ userId: req.user.userId })
      .sort({ date: 1, startTime: 1 });
    res.json({ appointments });
  } catch (error) {
    console.error('Randevuları getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Yeni randevu oluştur
app.post('/api/appointments', authenticateToken, async (req, res) => {
  try {
    const appointmentData = {
      ...req.body,
      userId: req.user.userId
    };
    
    const appointment = new Appointment(appointmentData);
    await appointment.save();
    
    res.status(201).json({
      message: 'Randevu başarıyla oluşturuldu',
      appointment
    });
  } catch (error) {
    console.error('Randevu oluşturma hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Randevu güncelle
app.put('/api/appointments/:id', authenticateToken, async (req, res) => {
  try {
    const appointment = await Appointment.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      req.body,
      { new: true }
    );
    
    if (!appointment) {
      return res.status(404).json({ error: 'Randevu bulunamadı' });
    }
    
    res.json({
      message: 'Randevu başarıyla güncellendi',
      appointment
    });
  } catch (error) {
    console.error('Randevu güncelleme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Randevu sil
app.delete('/api/appointments/:id', authenticateToken, async (req, res) => {
  try {
    const appointment = await Appointment.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.userId
    });
    
    if (!appointment) {
      return res.status(404).json({ error: 'Randevu bulunamadı' });
    }
    
    res.json({ message: 'Randevu başarıyla silindi' });
  } catch (error) {
    console.error('Randevu silme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Bugünkü randevuları getir
app.get('/api/appointments/today', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const appointments = await Appointment.find({
      userId: req.user.userId,
      date: {
        $gte: today,
        $lt: tomorrow
      }
    }).sort({ startTime: 1 });
    
    res.json({ appointments });
  } catch (error) {
    console.error('Bugünkü randevuları getirme hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// İstatistikleri getir
app.get('/api/statistics', authenticateToken, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Bugünkü randevular
    const todayAppointments = await Appointment.countDocuments({
      userId: req.user.userId,
      date: {
        $gte: today,
        $lt: tomorrow
      }
    });
    
    // Bu haftaki randevular
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    
    const weeklyAppointments = await Appointment.countDocuments({
      userId: req.user.userId,
      date: {
        $gte: startOfWeek,
        $lt: endOfWeek
      }
    });
    
    // Tamamlanan randevular
    const completedAppointments = await Appointment.countDocuments({
      userId: req.user.userId,
      status: 'completed'
    });
    
    res.json({
      statistics: {
        todayAppointments,
        weeklyPlans: weeklyAppointments,
        completedTasks: completedAppointments
      }
    });
  } catch (error) {
    console.error('İstatistik hatası:', error);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});