const User = require('../models/User');
const Business = require('../models/Business');
const CustomerFeature = require('../models/CustomerFeature');

async function resolveBusinessId(userId) {
  const actor = await User.findById(userId).select('businessId userType').lean();
  if (!actor) return null;
  let effectiveBusinessId = actor.businessId;
  if (!effectiveBusinessId && actor.userType === 'owner') {
    const biz = await Business.findOne({ ownerId: actor._id }).select('_id');
    if (biz) effectiveBusinessId = biz._id;
  }
  return effectiveBusinessId || null;
}

exports.getFeaturesByCustomer = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const { customerId } = req.params;
    const list = await CustomerFeature.find({ businessId, customerId: String(customerId) }).sort({ createdAt: -1 }).lean();
    return res.json({ features: list });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.createFeature = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const { customerId, featureKey, status, isEnabled, limits, validFrom, validUntil, note } = req.body || {};
    if (!customerId || !featureKey) return res.status(400).json({ error: 'Müşteri ve özellik anahtarı gerekli' });
    const doc = new CustomerFeature({
      businessId,
      createdBy: req.user.userId,
      customerId: String(customerId),
      featureKey: String(featureKey).trim(),
      status: ['approved', 'pending', 'revoked'].includes(String(status)) ? status : 'pending',
      isEnabled: typeof isEnabled === 'boolean' ? isEnabled : (String(status) === 'approved'),
      limits: limits && typeof limits === 'object' ? limits : {},
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : undefined,
      note: note ? String(note).trim() : ''
    });
    if (doc.status === 'approved') {
      doc.approvedBy = req.user.userId;
      doc.approvedAt = new Date();
    }
    await doc.save();
    return res.status(201).json({ success: true, feature: doc });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.updateFeature = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const { id } = req.params;
    const doc = await CustomerFeature.findOne({ _id: id, businessId });
    if (!doc) return res.status(404).json({ error: 'Özellik bulunamadı' });
    const { status, isEnabled, limits, validFrom, validUntil, note } = req.body || {};
    if (status && ['approved', 'pending', 'revoked'].includes(String(status))) {
      doc.status = status;
      if (status === 'approved') {
        doc.approvedBy = req.user.userId;
        doc.approvedAt = new Date();
      } else {
        doc.approvedBy = undefined;
        doc.approvedAt = undefined;
      }
    }
    if (typeof isEnabled === 'boolean') doc.isEnabled = isEnabled;
    if (limits && typeof limits === 'object') doc.limits = limits;
    if (validFrom !== undefined) doc.validFrom = validFrom ? new Date(validFrom) : doc.validFrom;
    if (validUntil !== undefined) doc.validUntil = validUntil ? new Date(validUntil) : undefined;
    if (note !== undefined) doc.note = note ? String(note).trim() : '';
    await doc.save();
    return res.json({ success: true, feature: doc });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.upsertFeatureByKey = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });
    const { customerId, featureKey, status, isEnabled, limits, validFrom, validUntil, note } = req.body || {};
    if (!customerId || !featureKey) return res.status(400).json({ error: 'Müşteri ve özellik anahtarı gerekli' });
    const updates = {
      createdBy: req.user.userId,
      status: ['approved', 'pending', 'revoked'].includes(String(status)) ? status : 'pending',
      isEnabled: typeof isEnabled === 'boolean' ? isEnabled : (String(status) === 'approved'),
      limits: limits && typeof limits === 'object' ? limits : {},
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : undefined,
      note: note ? String(note).trim() : ''
    };
    if (updates.status === 'approved') {
      updates.approvedBy = req.user.userId;
      updates.approvedAt = new Date();
    } else {
      updates.approvedBy = undefined;
      updates.approvedAt = undefined;
    }
    const doc = await CustomerFeature.findOneAndUpdate(
      { businessId, customerId: String(customerId), featureKey: String(featureKey).trim() },
      { $set: updates },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, feature: doc });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

