const User = require('../models/User');
const Business = require('../models/Business');
const UserFeature = require('../models/UserFeature');

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

exports.getMyFeatures = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    const list = await UserFeature.find({ userId: req.user.userId }).sort({ createdAt: -1 }).lean();
    return res.json({ features: list, businessId });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

exports.upsertMyFeature = async (req, res) => {
  try {
    const businessId = await resolveBusinessId(req.user.userId);
    const { featureKey, status, isEnabled, limits, validFrom, validUntil, note } = req.body || {};
    if (!featureKey) return res.status(400).json({ error: 'Özellik anahtarı gerekli' });
    const updates = {
      businessId,
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
    const doc = await UserFeature.findOneAndUpdate(
      { userId: req.user.userId, featureKey: String(featureKey).trim() },
      { $set: updates },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return res.json({ success: true, feature: doc });
  } catch (error) {
    return res.status(500).json({ error: 'Sunucu hatası' });
  }
};

