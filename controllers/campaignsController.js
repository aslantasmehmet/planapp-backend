const User = require('../models/User');
const Campaign = require('../models/Campaign');

exports.getCampaigns = async (req, res) => {
  try {
    const serviceNameFilter = (req.query && req.query.serviceName) ? String(req.query.serviceName).trim() : '';
    const query = { userId: req.user.userId };
    if (serviceNameFilter) query.serviceName = serviceNameFilter;
    const campaigns = await Campaign.find(query).sort({ createdAt: -1 }).lean();
    const formatted = campaigns.map(c => ({
      id: c._id?.toString?.(),
      name: c.name || '',
      content: c.content || '',
      sessionsCount: Number(c.sessionsCount) || 0,
      price: Number(c.price) || 0,
      serviceName: c.serviceName || '',
      createdAt: c.createdAt || new Date()
    }));
    res.json({ campaigns: formatted });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.addCampaign = async (req, res) => {
  try {
    const { name, content, sessionsCount, price, serviceName } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Kampanya adı gereklidir' });
    }
    if (!serviceName || !String(serviceName).trim()) {
      return res.status(400).json({ error: 'Hizmet bilgisi gereklidir' });
    }
    const owner = await User.findById(req.user.userId).select('businessId');
    const exists = await Campaign.findOne({ userId: req.user.userId, serviceName: String(serviceName).trim(), name: String(name).trim() });
    if (exists) {
      return res.status(400).json({ error: 'Bu kampanya zaten mevcut' });
    }
    const newItem = await Campaign.create({
      name: String(name).trim(),
      content: content || '',
      sessionsCount: parseInt(sessionsCount) || 0,
      price: parseFloat(price) || 0,
      serviceName: String(serviceName).trim(),
      userId: req.user.userId,
      businessId: owner?.businessId || null,
      createdBy: req.user.userId
    });
    res.json({ success: true, message: 'Kampanya eklendi', campaign: {
      id: newItem._id?.toString?.(),
      name: newItem.name,
      content: newItem.content,
      sessionsCount: newItem.sessionsCount,
      price: newItem.price,
      serviceName: newItem.serviceName,
      createdAt: newItem.createdAt
    } });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, content, sessionsCount, price, serviceName } = req.body;
    const item = await Campaign.findOne({ _id: id, userId: req.user.userId });
    if (!item) {
      return res.status(404).json({ error: 'Kampanya bulunamadı' });
    }
    if (name && String(name).trim()) {
      const exists = await Campaign.findOne({ _id: { $ne: id }, userId: req.user.userId, name: String(name).trim(), serviceName: String(serviceName || item.serviceName).trim() });
      if (exists) {
        return res.status(400).json({ error: 'Bu isimde bir kampanya zaten mevcut' });
      }
    }
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (content !== undefined) updates.content = content || '';
    if (sessionsCount !== undefined) updates.sessionsCount = parseInt(sessionsCount) || 0;
    if (price !== undefined) updates.price = parseFloat(price) || 0;
    if (serviceName !== undefined && String(serviceName).trim()) updates.serviceName = String(serviceName).trim();
    updates.updatedAt = new Date();
    await Campaign.updateOne({ _id: id, userId: req.user.userId }, { $set: updates });
    const fresh = await Campaign.findById(id).lean();
    res.json({ success: true, message: 'Kampanya güncellendi', campaign: {
      id: fresh._id?.toString?.(),
      name: fresh.name || '',
      content: fresh.content || '',
      sessionsCount: Number(fresh.sessionsCount) || 0,
      price: Number(fresh.price) || 0,
      serviceName: fresh.serviceName || '',
      createdAt: fresh.createdAt || new Date()
    } });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const { id } = req.params;
    const item = await Campaign.findOne({ _id: id, userId: req.user.userId });
    if (!item) {
      return res.status(404).json({ error: 'Kampanya bulunamadı' });
    }
    await Campaign.deleteOne({ _id: id, userId: req.user.userId });
    res.json({ success: true, message: 'Kampanya silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};
