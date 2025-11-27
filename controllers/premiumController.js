const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Business = require('../models/Business');

// Premium durumunu getir
exports.status = async (req, res) => {
  try {
    const actor = await User.findById(req.user.userId);
    if (!actor) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    let target = actor;
    if (actor.userType === 'staff') {
      try {
        const bizDoc = await Business.findById(actor.businessId);
        if (bizDoc && bizDoc.ownerId) {
          const ownerDoc = await User.findById(bizDoc.ownerId);
          if (ownerDoc) target = ownerDoc;
        } else {
          const ownerCandidate = await User.findById(actor.businessId);
          if (ownerCandidate && ownerCandidate.userType === 'owner') {
            target = ownerCandidate;
          }
        }
      } catch (e) { }
    }

    const now = new Date();
    const TRIAL_DAYS = 7;
    const trialStart = target.createdAt || new Date(0);
    const trialEndsAt = new Date(trialStart.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const trialActive = !target.isPremium && now < trialEndsAt;
    const daysLeft = trialActive ? Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)) : 0;

    let membershipCurrentMonth = 0;
    let membershipTotalMonths = target.membershipMonths || (target.planPeriod === 'annual' ? 12 : (target.planPeriod === 'monthly' ? 1 : 0));
    if (target.membershipStartedAt) {
      const start = new Date(target.membershipStartedAt);
      const monthsDiff = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
      membershipCurrentMonth = Math.min(Math.max(1, monthsDiff + 1), membershipTotalMonths || 12);
    }

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    let legacyOwnerId = null;
    if (actor.userType === 'owner') {
      legacyOwnerId = actor._id;
    } else {
      const bizDoc2 = await Business.findById(actor.businessId);
      if (bizDoc2 && bizDoc2.ownerId) {
        legacyOwnerId = bizDoc2.ownerId;
      } else {
        const ownerCandidate2 = await User.findById(actor.businessId);
        if (ownerCandidate2 && ownerCandidate2.userType === 'owner') {
          legacyOwnerId = ownerCandidate2._id;
        }
      }
    }
    const actorBusinessIdStr = actor.businessId?.toString?.() || String(actor.businessId || '');
    const legacyOwnerIdStr = legacyOwnerId?.toString?.() || String(legacyOwnerId || '');
    const businessIdQuery = legacyOwnerId && legacyOwnerIdStr !== actorBusinessIdStr
      ? { $in: [actor.businessId, legacyOwnerId] }
      : actor.businessId;

    const countFromAppointmentsThisMonth = await Appointment.countDocuments({
      businessId: businessIdQuery,
      isBlocked: false,
      status: { $ne: 'cancelled' },
      $or: [
        { createdAt: { $gte: startOfMonth, $lte: endOfMonth } },
        { $and: [
          { createdAt: { $exists: false } },
          { date: { $gte: startOfMonth, $lte: endOfMonth } }
        ] }
      ]
    });
    const usedCountThisMonth = Math.max(
      Number.isFinite(target.usedAppointmentsThisMonth) ? target.usedAppointmentsThisMonth : 0,
      countFromAppointmentsThisMonth
    );

    

    let usedCountThisYear = 0;
    if (target.planPeriod === 'annual' && target.membershipStartedAt && target.membershipEndsAt) {
      const membershipStart = new Date(target.membershipStartedAt);
      const membershipEnd = new Date(target.membershipEndsAt);
      usedCountThisYear = await Appointment.countDocuments({
        businessId: businessIdQuery,
        isBlocked: false,
        date: { $gte: membershipStart, $lte: membershipEnd },
        status: { $ne: 'cancelled' }
      });
    }

    const planQuotaMap = { plus: 200, pro: 400, premium: null };
    let effectiveMonthlyQuota = planQuotaMap[target.planType] ?? target.monthlyQuota ?? null;
    const membershipEndsAtDate = target.membershipEndsAt ? new Date(target.membershipEndsAt) : null;
    const membershipExpired = !!(membershipEndsAtDate && now >= membershipEndsAtDate);
    if (!target.isPremium && !trialActive) {
      effectiveMonthlyQuota = 0;
    }
    if (membershipExpired && !trialActive) {
      effectiveMonthlyQuota = 0;
    }
    const remainingMonthly = effectiveMonthlyQuota == null
      ? null
      : (membershipExpired && !trialActive ? 0 : Math.max(effectiveMonthlyQuota - usedCountThisMonth, 0));

    res.json({
      isPremium: target.isPremium,
      planType: target.planType || null,
      planPeriod: target.planPeriod || null,
      membershipStartedAt: target.membershipStartedAt || null,
      membershipEndsAt: target.membershipEndsAt || null,
      membershipMonths: membershipTotalMonths,
      membershipCurrentMonth,
      monthlyQuota: effectiveMonthlyQuota,
      remaining: remainingMonthly,
      usedAppointmentsThisMonth: usedCountThisMonth,
      usedAppointmentsThisYear: usedCountThisYear,
      annualQuota: effectiveMonthlyQuota == null ? null : (membershipTotalMonths > 0 ? effectiveMonthlyQuota * membershipTotalMonths : null),
      lastResetAt: target.lastResetAt || null,
      trialStart,
      trialEndsAt,
      trialActive,
      trialDaysLeft: daysLeft,
      membershipExpired
    });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};

// Premium aktivasyon
exports.activate = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }

    const { plan, period } = req.body || {};
    const validPlans = ['plus', 'pro', 'premium'];
    const validPeriods = ['monthly', 'annual'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Geçersiz plan' });
    }
    const planPeriod = validPeriods.includes(period) ? period : 'monthly';

    const now = new Date();
    const months = planPeriod === 'annual' ? 12 : 1;
    const ends = new Date(now);
    ends.setMonth(ends.getMonth() + months);

    let monthlyQuota = null;
    if (plan === 'plus') monthlyQuota = 200;
    if (plan === 'pro') monthlyQuota = 400;
    if (plan === 'premium') monthlyQuota = null;

    user.isPremium = true;
    user.premiumStartedAt = now;
    user.planType = plan;
    user.planPeriod = planPeriod;
    user.membershipStartedAt = now;
    user.membershipEndsAt = ends;
    user.membershipMonths = months;
    user.monthlyQuota = monthlyQuota;
    user.usedAppointmentsThisMonth = 0;
    user.lastResetAt = now;
    await user.save();

    res.json({ message: 'Üyelik aktif edildi', isPremium: true, planType: plan, planPeriod });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
};
