const path = require('path');
const fs = require('fs');
const User = require('../models/User');

// GET /api/services
exports.getServices = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }

    const { staffId } = req.query;
    if (user.userType === 'owner' && staffId && staffId !== 'all') {
      const staff = await User.findOne({ _id: staffId, userType: 'staff', createdBy: user._id }).select('services name');
      if (!staff) {
        return res.status(404).json({ error: 'Personel bulunamadı veya yetkiniz yok' });
      }
      const services = staff.services || [];
      const formattedServices = services.map(service => {
        if (typeof service === 'string') {
          return { id: Date.now().toString() + Math.random().toString(36).substr(2, 9), name: service, description: '', duration: 0, price: 0, images: [], createdAt: new Date() };
        }
        if (typeof service === 'object' && service !== null && !service.name) {
          const keys = Object.keys(service).filter(key => !isNaN(key));
          if (keys.length > 0) {
            const reconstructedString = keys.sort((a, b) => parseInt(a) - parseInt(b)).map(key => service[key]).join('');
            return {
              id: service._id || service.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
              name: reconstructedString,
              description: service.description || '',
              duration: parseInt(service.duration) || 0,
              price: parseFloat(service.price) || 0,
              images: service.images || [],
              createdAt: service.createdAt || new Date()
            };
          }
        }
        if (typeof service === 'object' && service !== null && service.name) {
          return {
            id: service._id || service.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name: service.name,
            description: service.description || '',
            duration: service.duration !== undefined ? Number(service.duration) : 0,
            price: service.price !== undefined ? Number(service.price) : 0,
            images: service.images || [],
            showInStore: service.showInStore !== undefined ? service.showInStore : true,
            storeDescription: service.storeDescription || '',
            storeImages: service.storeImages || [],
            createdAt: service.createdAt || new Date()
          };
        }
        return { id: Date.now().toString() + Math.random().toString(36).substr(2, 9), name: String(service), description: '', duration: 0, price: 0, images: [], createdAt: new Date() };
      });
      return res.json({ services: formattedServices });
    }

    const userWithServices = await User.findById(req.user.userId).select('services');
    const services = userWithServices?.services || [];
    const formattedServices = services.map(service => {
      if (typeof service === 'string') {
        return { id: Date.now().toString() + Math.random().toString(36).substr(2, 9), name: service, description: '', duration: 0, price: 0, images: [], createdAt: new Date() };
      }
      if (typeof service === 'object' && service !== null && !service.name) {
        const keys = Object.keys(service).filter(key => !isNaN(key));
        if (keys.length > 0) {
          const reconstructedString = keys.sort((a, b) => parseInt(a) - parseInt(b)).map(key => service[key]).join('');
          return {
            id: service._id || service.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
            name: reconstructedString,
            description: service.description || '',
            duration: service.duration !== undefined ? Number(service.duration) : 0,
            price: service.price !== undefined ? Number(service.price) : 0,
            images: service.images || [],
            createdAt: service.createdAt || new Date()
          };
        }
      }
      if (typeof service === 'object' && service !== null) {
        return {
          id: service._id || service.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: service.name || String(service),
          description: service.description || '',
          duration: service.duration !== undefined ? Number(service.duration) : 0,
          price: service.price !== undefined ? Number(service.price) : 0,
          images: service.images || [],
          showInStore: service.showInStore !== undefined ? service.showInStore : true,
          storeDescription: service.storeDescription || '',
          storeImages: service.storeImages || [],
          createdAt: service.createdAt || new Date()
        };
      }
      return { id: Date.now().toString() + Math.random().toString(36).substr(2, 9), name: String(service), description: '', duration: 0, price: 0, images: [], createdAt: new Date() };
    });
    res.json({ services: formattedServices });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// POST /api/services
exports.saveServices = async (req, res) => {
  try {
    const { services } = req.body;
    if (!Array.isArray(services)) {
      return res.status(400).json({ error: 'Hizmetler array formatında olmalıdır' });
    }
    const formattedServices = services.map(service => {
      if (typeof service === 'string') {
        return { id: Date.now().toString() + Math.random().toString(36).substr(2, 9), name: service.trim(), images: [], createdAt: new Date() };
      }
      return service;
    });
    await User.findByIdAndUpdate(req.user.userId, { services: formattedServices }, { new: true });
    res.json({ message: 'Hizmetler başarıyla kaydedildi', services: formattedServices });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// POST /api/services/add
exports.addService = async (req, res) => {
  try {
    const serviceData = req.body.service || req.body;
    if (!serviceData || !serviceData.name) {
      return res.status(400).json({ error: 'Hizmet adı gereklidir' });
    }
    const serviceName = serviceData.name.trim();
    if (!serviceName) {
      return res.status(400).json({ error: 'Hizmet adı gereklidir' });
    }
    const user = await User.findById(req.user.userId);
    const currentServices = user.services || [];
    const existingService = currentServices.find(s => (typeof s === 'string' ? s : s.name) === serviceName);
    if (existingService) {
      return res.status(400).json({ error: 'Bu hizmet zaten mevcut' });
    }
    const newService = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: serviceName,
      description: serviceData.description || '',
      duration: Number(serviceData.duration) || 0,
      price: Number(serviceData.price) || 0,
      images: serviceData.images || [],
      showInStore: serviceData.showInStore !== undefined ? serviceData.showInStore : true,
      createdAt: new Date()
    };
    const updatedServices = [...currentServices, newService];
    await User.findByIdAndUpdate(req.user.userId, { services: updatedServices }, { new: true });
    res.json({ success: true, message: 'Hizmet başarıyla eklendi', service: newService, services: updatedServices });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Sunucu hatası' });
  }
};

// GET /api/services/user
exports.getUserServices = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.businessId) {
      return res.status(400).json({ error: 'Kullanıcının işletme bilgisi bulunamadı' });
    }
    const userWithServices = await User.findById(req.user.userId).select('services');
    const services = userWithServices?.services || [];
    res.json({ success: true, services });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// PUT /api/services/:id
exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, duration, price, showInStore, storeDescription, storeImages } = req.body;
    const user = await User.findById(req.user.userId);
    const currentServices = user.services || [];

    const serviceIndex = currentServices.findIndex(s => {
      if (typeof s === 'object' && s !== null) {
        const serviceId = (s._id || s.id)?.toString();
        return serviceId === id;
      }
      return s === id;
    });

    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }

    const currentService = currentServices[serviceIndex];

    if (name && name.trim()) {
      const existingService = currentServices.find((s, index) => index !== serviceIndex && (typeof s === 'string' ? s : s.name) === name.trim());
      if (existingService) {
        return res.status(400).json({ error: 'Bu isimde bir hizmet zaten mevcut' });
      }
    }

    const updates = {};
    if (name !== undefined) updates.name = (name || '').trim();
    if (description !== undefined) updates.description = description;
    if (duration !== undefined) updates.duration = parseInt(duration) || 0;
    if (price !== undefined) updates.price = parseFloat(price) || 0;
    if (showInStore !== undefined) updates.showInStore = !!showInStore;
    if (storeDescription !== undefined) updates.storeDescription = storeDescription;
    if (storeImages !== undefined) updates.storeImages = storeImages;
    updates.updatedAt = new Date();

    const setPayload = {};
    Object.entries(updates).forEach(([k, v]) => { setPayload[`services.$.${k}`] = v; });

    const matchByObjectId = (currentService && currentService._id) ? { 'services._id': currentService._id } : null;
    const matchByCustomId = (currentService && currentService.id) ? { 'services.id': currentService.id } : null;

    let modified = 0;
    if (matchByObjectId) {
      const res1 = await User.updateOne({ _id: req.user.userId, ...matchByObjectId }, { $set: setPayload });
      modified += res1.modifiedCount || res1.nModified || 0;
    }
    if (!modified && matchByCustomId) {
      const res2 = await User.updateOne({ _id: req.user.userId, ...matchByCustomId }, { $set: setPayload });
      modified += res2.modifiedCount || res2.nModified || 0;
    }
    if (!modified) {
      return res.status(404).json({ error: 'Hizmet güncellenemedi (eşleşme bulunamadı)' });
    }

    const freshUser = await User.findById(req.user.userId);
    const freshServices = freshUser?.services || [];
    const fresh = freshServices.find(s => ((s?._id || s?.id)?.toString?.() || s) === id);
    const responseService = fresh ? { ...(typeof fresh === 'object' ? fresh.toObject?.() || fresh : { name: fresh || '', description: '', duration: 0, price: 0 }), id: (fresh?._id && fresh._id.toString) ? fresh._id.toString() : (fresh?.id || id) } : { ...currentService, ...updates, id: (currentService?._id && currentService._id.toString) ? currentService._id.toString() : (currentService?.id || id) };

    res.json({ success: true, message: 'Hizmet başarıyla güncellendi', service: responseService, services: freshServices });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// DELETE /api/services/:id
exports.deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(req.user.userId);
    const currentServices = user.services || [];
    const serviceIndex = currentServices.findIndex(s => {
      if (typeof s === 'object' && s !== null) {
        return s.id === id || s._id === id || s._id?.toString() === id;
      }
      return s === id;
    });
    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }
    const deletedService = currentServices[serviceIndex];
    currentServices.splice(serviceIndex, 1);
    await User.findByIdAndUpdate(req.user.userId, { services: currentServices }, { new: true });
    res.json({ message: 'Hizmet başarıyla silindi', deletedService, services: currentServices });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// POST /api/services/:serviceId/upload-images
exports.uploadServiceImages = async (req, res) => {
  try {
    if (!req.body.images || !Array.isArray(req.body.images) || req.body.images.length === 0) {
      return res.status(400).json({ error: 'En az bir görsel verisi gereklidir' });
    }
    const { serviceId } = req.params;
    if (!serviceId) {
      return res.status(400).json({ error: 'Hizmet ID gereklidir' });
    }
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    const serviceIndex = user.services.findIndex(service => service.id == serviceId || service._id == serviceId || service._id?.toString() == serviceId);
    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }
    if (!user.services[serviceIndex].images) {
      user.services[serviceIndex].images = [];
    }
    user.services[serviceIndex].images = req.body.images.slice(0, 5);
    await user.save();
    res.json({ success: true, message: 'Görseller başarıyla yüklendi', images: user.services[serviceIndex].images, service: user.services[serviceIndex] });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// POST /api/services/upload-image
exports.uploadServiceImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Görsel dosyası gereklidir' });
    }
    const { serviceId } = req.body;
    if (!serviceId) {
      return res.status(400).json({ error: 'Hizmet ID gereklidir' });
    }
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    const serviceIndex = user.services.findIndex(service => service.id == serviceId || service._id == serviceId || service._id?.toString() == serviceId);
    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    if (!user.services[serviceIndex].images) {
      user.services[serviceIndex].images = [];
    }
    if (user.services[serviceIndex].images.length >= 5) {
      const oldImagePath = path.join(__dirname, user.services[serviceIndex].images[0]);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
      user.services[serviceIndex].images.shift();
    }
    user.services[serviceIndex].images.push(imageUrl);
    await user.save();
    res.json({ success: true, message: 'Görsel başarıyla yüklendi', imageUrl, service: user.services[serviceIndex] });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// DELETE /api/services/:serviceId/images/:imageIndex
exports.deleteServiceImage = async (req, res) => {
  try {
    const { serviceId, imageIndex } = req.params;
    const index = parseInt(imageIndex);
    if (isNaN(index) || index < 0) {
      return res.status(400).json({ error: 'Geçersiz görsel indeksi' });
    }
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    const serviceIndex = user.services.findIndex(service => service.id == serviceId || service._id == serviceId || service._id?.toString() == serviceId);
    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }
    const service = user.services[serviceIndex];
    if (!service.images || index >= service.images.length) {
      return res.status(404).json({ error: 'Görsel bulunamadı' });
    }
    service.images.splice(index, 1);
    await user.save();
    res.json({ success: true, message: 'Görsel başarıyla silindi', images: service.images });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};
