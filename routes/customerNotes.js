const express = require('express');
const router = express.Router();

const mongoose = require('mongoose');
const { authenticateToken } = require('../middlewares/auth');
const User = require('../models/User');
const Business = require('../models/Business');
const Customer = require('../models/Customer');
const CustomerNote = require('../models/CustomerNote');

async function resolveBusinessId(userId) {
  const actor = await User.findById(userId).select('userType businessId createdBy');
  if (!actor) return null;
  let effectiveBusinessId = actor.businessId || null;
  if (!effectiveBusinessId && actor.userType === 'owner') {
    const biz = await Business.findOne({ ownerId: actor._id }).select('_id');
    if (biz) effectiveBusinessId = biz._id;
  }
  if (!effectiveBusinessId && actor.userType === 'staff') {
    const fallbackBiz = await Business.findOne({ ownerId: actor.createdBy || actor.businessId }).select('_id');
    if (fallbackBiz) effectiveBusinessId = fallbackBiz._id;
  }
  return effectiveBusinessId;
}

router.get('/:customerId', authenticateToken, async (req, res) => {
  try {
    const { customerId } = req.params;
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bulunamadı' });

    let realCustomerId = null;
    if (mongoose.Types.ObjectId.isValid(customerId)) {
      realCustomerId = customerId;
    } else {
      const legacy = await Customer.findOne({ legacyId: customerId, businessId }).select('_id');
      realCustomerId = legacy?._id || null;
    }
    if (!realCustomerId) return res.status(404).json({ error: 'Müşteri bulunamadı' });

    const notes = await CustomerNote.find({ businessId, customerId: realCustomerId }).sort({ pinned: -1, createdAt: -1 });
    res.json({ notes });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/:customerId', authenticateToken, async (req, res) => {
  try {
    const { customerId } = req.params;
    const { note, title, category, tags, pinned } = req.body;
    if (!note || !String(note).trim()) {
      return res.status(400).json({ error: 'Not içeriği zorunludur' });
    }
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bulunamadı' });

    let realCustomerId = null;
    if (mongoose.Types.ObjectId.isValid(customerId)) {
      realCustomerId = customerId;
    } else {
      const legacy = await Customer.findOne({ legacyId: customerId, businessId }).select('_id');
      realCustomerId = legacy?._id || null;
    }
    if (!realCustomerId) return res.status(404).json({ error: 'Müşteri bulunamadı' });

    const created = await CustomerNote.create({
      businessId,
      customerId: realCustomerId,
      title: String(title || '').trim(),
      category: String(category || 'Genel').trim(),
      tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : String(tags || '').split(',').map(x => x.trim()).filter(Boolean),
      pinned: !!pinned,
      note: String(note).trim(),
      createdBy: req.user.userId,
    });
    res.status(201).json({ message: 'Not eklendi', note: created });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.put('/:noteId', authenticateToken, async (req, res) => {
  try {
    const { noteId } = req.params;
    const { note, title, category, tags, pinned } = req.body;
    if (!note || !String(note).trim()) {
      return res.status(400).json({ error: 'Not içeriği zorunludur' });
    }
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      return res.status(400).json({ error: 'Geçersiz not ID' });
    }
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bulunamadı' });

    const updateSet = {
      note: String(note).trim(),
    };
    if (title !== undefined) updateSet.title = String(title || '').trim();
    if (category !== undefined) updateSet.category = String(category || 'Genel').trim();
    if (tags !== undefined) updateSet.tags = Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : String(tags || '').split(',').map(x => x.trim()).filter(Boolean);
    if (pinned !== undefined) updateSet.pinned = !!pinned;

    const updated = await CustomerNote.findOneAndUpdate(
      { _id: noteId, businessId },
      { $set: updateSet },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Not bulunamadı' });
    res.json({ message: 'Not güncellendi', note: updated });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.delete('/:noteId', authenticateToken, async (req, res) => {
  try {
    const { noteId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(noteId)) {
      return res.status(400).json({ error: 'Geçersiz not ID' });
    }
    const businessId = await resolveBusinessId(req.user.userId);
    if (!businessId) return res.status(404).json({ error: 'İşletme bulunamadı' });

    const deleted = await CustomerNote.findOneAndDelete({ _id: noteId, businessId });
    if (!deleted) return res.status(404).json({ error: 'Not bulunamadı' });
    res.json({ message: 'Not silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;
