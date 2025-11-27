const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Business = require('../models/Business');

// İşletme oluştur
exports.create = async (req, res) => {
  try {
    const { name, address, phone, email, businessType, description, workingHours, locationLat, locationLon, locationVerified, locationMethod } = req.body;

    if (!name || !address || !phone || !businessType) {
      return res.status(400).json({ error: 'İşletme adı, adres, telefon ve işletme türü gereklidir' });
    }

    const existingBusiness = await Business.findOne({ ownerId: req.user.userId });
    if (existingBusiness) {
      return res.status(400).json({ error: 'Zaten bir işletmeniz var' });
    }

    const businessData = {
      name,
      address,
      phone,
      email,
      businessType,
      description,
      workingHours,
      ownerId: req.user.userId,
      locationLat: typeof locationLat === 'number' ? locationLat : undefined,
      locationLon: typeof locationLon === 'number' ? locationLon : undefined,
      locationVerified: typeof locationVerified === 'boolean' ? locationVerified : false,
      locationMethod: typeof locationMethod === 'string' ? locationMethod : undefined
    };

    const business = new Business(businessData);
    await business.save();

    try {
      await User.findByIdAndUpdate(
        req.user.userId,
        { businessId: business._id },
        { new: true }
      );
    } catch (e) { }

    res.status(201).json({
      success: true,
      message: 'İşletme bilgileri başarıyla kaydedildi',
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        businessType: business.businessType,
        description: business.description,
        workingHours: business.workingHours,
        locationLat: business.locationLat,
        locationLon: business.locationLon,
        locationVerified: business.locationVerified,
        locationMethod: business.locationMethod
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// İşletme bilgilerini getir
exports.get = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    let business;
    if (user.userType === 'owner') {
      business = await Business.findOne({ ownerId: req.user.userId });
    } else if (user.userType === 'staff') {
      if (!user.businessId) {
        return res.json({ business: null, message: 'Staff kullanıcısının işletme bilgisi bulunamadı' });
      }
      business = await Business.findById(user.businessId);
      if (!business) {
        const fallbackBiz = await Business.findOne({ ownerId: user.businessId });
        if (fallbackBiz) {
          business = fallbackBiz;
          try {
            await User.findByIdAndUpdate(user._id, { businessId: fallbackBiz._id });
          } catch (e) {
          }
        }
      }
    }

    if (!business) {
      return res.json({ business: null, message: 'İşletme bilgisi bulunamadı' });
    }

    res.json({
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        businessType: business.businessType,
        description: business.description,
        logo: business.logo,
        workingHours: business.workingHours,
        images: business.images || [],
        isActive: business.isActive,
        locationLat: business.locationLat,
        locationLon: business.locationLon,
        locationVerified: business.locationVerified,
        locationMethod: business.locationMethod
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// İşletme bilgilerini güncelle
exports.update = async (req, res) => {
  try {
    const { name, address, phone, email, businessType, description, workingHours, locationLat, locationLon, locationVerified, locationMethod } = req.body;
    const business = await Business.findOne({ ownerId: req.user.userId });
    if (!business) {
      return res.status(404).json({ error: 'İşletme bilgisi bulunamadı' });
    }

    if (name) business.name = name;
    if (address) business.address = address;
    if (phone) business.phone = phone;
    if (email) business.email = email;
    if (businessType) business.businessType = businessType;
    if (description) business.description = description;
    if (workingHours) business.workingHours = workingHours;
    if (typeof locationLat === 'number') business.locationLat = locationLat;
    if (typeof locationLon === 'number') business.locationLon = locationLon;
    if (typeof locationVerified === 'boolean') business.locationVerified = locationVerified;
    if (typeof locationMethod === 'string') business.locationMethod = locationMethod;

    await business.save();

    res.json({
      success: true,
      message: 'İşletme bilgileri başarıyla güncellendi',
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        businessType: business.businessType,
        description: business.description,
        workingHours: business.workingHours,
        locationLat: business.locationLat,
        locationLon: business.locationLon,
        locationVerified: business.locationVerified,
        locationMethod: business.locationMethod
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// İşletme resimlerini güncelle (base64)
exports.updateImages = async (req, res) => {
  try {
    const { images } = req.body;
    if (!images || !Array.isArray(images)) {
      return res.status(400).json({ error: 'Geçerli resim verisi gerekli' });
    }
    if (images.length > 5) {
      return res.status(400).json({ error: 'Maksimum 5 resim yüklenebilir' });
    }

    const business = await Business.findOne({ ownerId: req.user.userId });
    if (!business) {
      return res.status(404).json({ error: 'İşletme bilgisi bulunamadı' });
    }

    business.images = images;
    await business.save();

    res.json({ success: true, message: 'Resimler başarıyla güncellendi', images: business.images });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// İşletme resimlerini sil
exports.deleteImages = async (req, res) => {
  try {
    const business = await Business.findOne({ ownerId: req.user.userId });
    if (!business) {
      return res.status(404).json({ error: 'İşletme bilgisi bulunamadı' });
    }
    business.images = [];
    await business.save();
    res.json({ success: true, message: 'Tüm resimler başarıyla silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Resim silme hatası', details: error.message });
  }
};

// Logo yükle
exports.uploadLogo = async (req, res) => {
  try {
    if (!req.body.logo) {
      return res.status(400).json({ error: 'Logo verisi gönderilmedi' });
    }
    const business = await Business.findOne({ ownerId: req.user.userId });
    if (!business) {
      return res.status(404).json({ error: 'İşletme kaydı bulunamadı' });
    }
    business.logo = req.body.logo;
    await business.save();

    res.json({
      success: true,
      message: 'Logo başarıyla yüklendi',
      logoUrl: req.body.logo,
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        logo: business.logo,
        workingHours: business.workingHours,
        images: business.images,
        isActive: business.isActive
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Logo yüklenirken hata oluştu', details: error.message });
  }
};

// Logo sil
exports.deleteLogo = async (req, res) => {
  try {
    const business = await Business.findOne({ ownerId: req.user.userId });
    if (!business) {
      return res.status(404).json({ error: 'İşletme kaydı bulunamadı' });
    }

    if (business.logo) {
      const logoPath = path.join(__dirname, 'uploads', path.basename(business.logo));
      if (fs.existsSync(logoPath)) {
        fs.unlinkSync(logoPath);
      }
    }

    business.logo = '';
    await business.save();

    res.json({
      success: true,
      message: 'Logo başarıyla silindi',
      business: {
        id: business._id,
        name: business.name,
        address: business.address,
        phone: business.phone,
        email: business.email,
        logo: business.logo,
        workingHours: business.workingHours,
        images: business.images,
        isActive: business.isActive
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Logo silinirken hata oluştu', details: error.message });
  }
};
