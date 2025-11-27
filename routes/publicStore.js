const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Business = require('../models/Business');
const BlockedTime = require('../models/BlockedTime');
const AppointmentRequest = require('../models/AppointmentRequest');

// Public mağaza verilerini getir (storeName ile)
router.get('/:storeName', async (req, res) => {
  try {
    const { storeName } = req.params;
    if (!storeName) return res.status(400).json({ error: 'Mağaza adı gerekli' });

    const user = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    });

    if (!user || !user.storeSettings || !user.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    const business = await Business.findOne({ ownerId: user._id });

    const ownerServices = Array.isArray(user.services) ? user.services : [];
    const staffUsers = user.businessId 
      ? await User.find({ userType: 'staff', businessId: user.businessId }).select('services name')
      : [];
    const staffServices = Array.isArray(staffUsers)
      ? staffUsers.flatMap(u => Array.isArray(u.services) ? u.services : [])
      : [];
    const combinedServicesRaw = [...ownerServices, ...staffServices];

    const combinedFormatted = combinedServicesRaw
      .filter(service => {
        if (typeof service === 'string') return true;
        return service?.showInStore !== false;
      })
      .map(service => {
        if (typeof service === 'object' && service !== null) {
          return {
            id: service.id || service._id,
            name: service.name || String(service),
            description: service.description || '',
            duration: service.duration !== undefined ? Number(service.duration) : 0,
            price: service.price !== undefined ? Number(service.price) : 0,
            images: service.images || [],
            storeImages: service.storeImages || [],
            storeDescription: service.storeDescription || '',
            showInStore: service.showInStore !== undefined ? service.showInStore : true,
            createdAt: service.createdAt || new Date()
          };
        }
        return {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: String(service),
          description: '',
          duration: 0,
          price: 0,
          images: [],
          storeImages: [],
          storeDescription: '',
          showInStore: true,
          createdAt: new Date()
        };
      });

    const serviceMap = new Map();
    for (const s of combinedFormatted) {
      const key = (s.name || '').trim().toLowerCase();
      if (!serviceMap.has(key)) serviceMap.set(key, s);
    }
    const combinedServices = Array.from(serviceMap.values());

    const storeData = {
      storeName: user.storeSettings.storeName,
      storeDescription: user.storeSettings.storeDescription,
      enabled: user.storeSettings.enabled,
      showServiceDurations: user.storeSettings.showServiceDurations,
      allowStaffSelection: user.storeSettings.allowStaffSelection,
      allowAppointmentCancellation: user.storeSettings.allowAppointmentCancellation,
      showPlanlyoLogo: user.storeSettings.showPlanlyoLogo,
      enableChatAssistant: user.storeSettings.enableChatAssistant,
      services: combinedServices,
      business: business ? {
        name: business.name,
        description: business.description,
        address: business.address,
        phone: business.phone,
        email: business.email,
        website: business.website,
        logo: business.logo,
        images: Array.isArray(business.images) ? business.images : [],
        services: business.services,
        staff: business.staff,
        workingHours: business.workingHours,
        locationLat: business.locationLat,
        locationLon: business.locationLon,
        locationVerified: business.locationVerified,
        locationMethod: business.locationMethod
      } : null
    };

    res.json(storeData);
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Public randevu oluşturma
router.post('/:storeName/appointments', async (req, res) => {
  try {
    const { storeName } = req.params;
    const {
      customerName,
      customerPhone,
      customerEmail,
      serviceId,
      serviceName,
      staffId,
      date,
      time
    } = req.body;

    if (!storeName || !customerName || !customerPhone || (!serviceId && !serviceName) || !date || !time) {
      return res.status(400).json({
        error: 'Mağaza adı, müşteri adı, telefon, hizmet (ID veya isim), tarih ve saat gerekli'
      });
    }

    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    }).populate('businessId');

    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    const now = new Date();
    const TRIAL_DAYS = 7;
    const trialStartLocal = storeOwner.createdAt || new Date(0);
    const trialEndsAtLocal = new Date(trialStartLocal.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    if (!storeOwner.isPremium && now >= trialEndsAtLocal) {
      return res.status(403).json({ error: 'Mağaza için deneme süresi sona erdi. Paket satın alınmadan randevu alınamaz.' });
    }

    try {
      const membershipEndsAtLocal = storeOwner.membershipEndsAt ? new Date(storeOwner.membershipEndsAt) : null;
      const membershipExpiredLocal = !!(membershipEndsAtLocal && now >= membershipEndsAtLocal);
      if (membershipExpiredLocal) {
        return res.status(403).json({ error: 'Mağaza üyeliği sona erdi. Paket yenilenmeden randevu alınamaz.' });
      }
    } catch (expErr) {}

    try {
      const planQuotaMap = { plus: 200, pro: 400, premium: null };
      const effectiveMonthlyQuota = planQuotaMap[storeOwner.planType] ?? storeOwner.monthlyQuota ?? null;
      if (storeOwner.isPremium && effectiveMonthlyQuota != null) {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const usedCountThisMonth = await Appointment.countDocuments({
          businessId: storeOwner.businessId._id,
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
        if (usedCountThisMonth >= effectiveMonthlyQuota) {
          return res.status(403).json({ error: 'Aylık randevu hakkı doldu. Yeni dönem başlayınca tekrar deneyin.' });
        }
      }
    } catch (quotaErr) {}

    let service = null;
    let serviceCreatorId = null;

    if (storeOwner.services && Array.isArray(storeOwner.services)) {
      const ownerService = storeOwner.services.find(s => {
        const sid = (typeof s === 'object' && s !== null) ? (s.id || s._id) : s;
        return serviceId && sid && sid.toString() === serviceId;
      });
      if (ownerService) {
        service = ownerService;
        serviceCreatorId = storeOwner._id;
      }
    }

    const business = storeOwner.businessId;
    const businessIdVal = business && business._id ? business._id : business;
    let staffUsers = [];
    try {
      staffUsers = await User.find({ userType: 'staff', businessId: businessIdVal }).select('_id name email phone services workingHours customers');
    } catch (e) {
      staffUsers = [];
    }

    if (!service && Array.isArray(staffUsers) && staffUsers.length > 0) {
      for (const staff of staffUsers) {
        if (staff.services && Array.isArray(staff.services)) {
          const staffService = staff.services.find(s => {
            const sid = (typeof s === 'object' && s !== null) ? (s.id || s._id) : s;
            return serviceId && sid && sid.toString() === serviceId;
          });
          if (staffService) {
            service = staffService;
            serviceCreatorId = staff._id;
            break;
          }
        }
      }
    }

    if (!service && serviceName) {
      const normName = String(serviceName).trim().toLowerCase();
      if (storeOwner.services && Array.isArray(storeOwner.services)) {
        const ownerServiceByName = storeOwner.services.find(s => {
          const sname = (typeof s === 'object' && s !== null) ? (s.name || '') : String(s || '');
          return sname.trim().toLowerCase() === normName;
        });
        if (ownerServiceByName) {
          service = ownerServiceByName;
          serviceCreatorId = storeOwner._id;
        }
      }
      if (!service && Array.isArray(staffUsers) && staffUsers.length > 0) {
        for (const staff of staffUsers) {
          if (staff.services && Array.isArray(staff.services)) {
            const staffServiceByName = staff.services.find(s => {
              const sname = (typeof s === 'object' && s !== null) ? (s.name || '') : String(s || '');
              return sname.trim().toLowerCase() === normName;
            });
            if (staffServiceByName) {
              service = staffServiceByName;
              serviceCreatorId = staff._id;
              break;
            }
          }
        }
      }
    }

    if (!service) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }

    let selectedStaffDoc = null;
    if (staffId && staffId !== 'all') {
      selectedStaffDoc = staffUsers.find(s => s._id.toString() === staffId);
      if (!selectedStaffDoc) return res.status(404).json({ error: 'Personel bulunamadı' });
    } else if (!staffId && serviceCreatorId) {
      selectedStaffDoc = staffUsers.find(s => s._id.toString() === serviceCreatorId.toString()) || null;
    }

    const providerUserId = selectedStaffDoc ? selectedStaffDoc._id : storeOwner._id;
    const providerIsStaff = !!selectedStaffDoc;

    const ownerCustomers = Array.isArray(storeOwner.customers) ? storeOwner.customers : [];
    const staffCustomers = selectedStaffDoc && Array.isArray(selectedStaffDoc.customers) ? selectedStaffDoc.customers : [];
    const existingCustomerInOwner = ownerCustomers.find(c => c.phone === String(customerPhone).trim());
    const existingCustomerInStaff = staffCustomers.find(c => c.phone === String(customerPhone).trim());

    let effectiveBusinessId = storeOwner.businessId && storeOwner.businessId._id ? storeOwner.businessId._id : storeOwner.businessId;

    let customerObj = existingCustomerInStaff || existingCustomerInOwner || null;
    if (customerObj && !existingCustomerInStaff && providerIsStaff) {
      const newCustomerForStaff = {
        id: customerObj.id || Date.now().toString(),
        name: customerObj.name || customerName,
        phone: customerObj.phone,
        email: customerObj.email || (customerEmail ? String(customerEmail).trim() : ''),
        addedBy: providerUserId,
        businessId: effectiveBusinessId,
        createdAt: customerObj.createdAt || new Date().toISOString()
      };
      const updatedStaffCustomers = [...staffCustomers, newCustomerForStaff];
      await User.findByIdAndUpdate(providerUserId, { customers: updatedStaffCustomers }, { new: true });
    }

    if (!customerObj) {
      const newCustomer = {
        id: Date.now().toString(),
        name: String(customerName).trim(),
        phone: String(customerPhone).trim(),
        email: customerEmail ? String(customerEmail).trim() : '',
        addedBy: providerUserId,
        businessId: effectiveBusinessId,
        createdAt: new Date().toISOString()
      };

      if (providerIsStaff) {
        const updatedStaffCustomers = [...staffCustomers, newCustomer];
        await User.findByIdAndUpdate(providerUserId, { customers: updatedStaffCustomers }, { new: true });
        const ownerHasSame = ownerCustomers.find(c => c.phone === newCustomer.phone);
        if (!ownerHasSame) {
          const updatedOwnerCustomers = [...ownerCustomers, newCustomer];
          await User.findByIdAndUpdate(storeOwner._id, { customers: updatedOwnerCustomers }, { new: true });
        }
      } else {
        const updatedOwnerCustomers = [...ownerCustomers, newCustomer];
        await User.findByIdAndUpdate(storeOwner._id, { customers: updatedOwnerCustomers }, { new: true });
      }
    }

    const serviceNameEffective = (typeof service === 'object' && service !== null) ? (service.name || String(service)) : String(service);
    const serviceDurationMin = (typeof service === 'object' && service !== null) ? (Number(service.duration) || 60) : 60;
    const startTimeStr = String(time).trim();
    const [sh, sm] = startTimeStr.split(':').map(n => parseInt(n, 10));
    const startDate = new Date(date);
    const endDate = new Date(startDate.getTime());
    endDate.setHours(sh || 0, (sm || 0) + serviceDurationMin, 0, 0);
    const endHours = endDate.getHours().toString().padStart(2, '0');
    const endMinutes = endDate.getMinutes().toString().padStart(2, '0');
    const endTimeStr = `${endHours}:${endMinutes}`;

    const appointmentData = {
      title: serviceNameEffective,
      description: '',
      clientName: String(customerName).trim(),
      clientEmail: customerEmail ? String(customerEmail).trim() : '',
      clientPhone: String(customerPhone).trim(),
      date: startDate,
      startTime: startTimeStr,
      endTime: endTimeStr,
      status: 'scheduled',
      isBlocked: false,
      type: serviceNameEffective,
      serviceId: (typeof service === 'object' && service !== null) ? (service.id || service._id || serviceId || '') : (serviceId || ''),
      notes: `Mağaza sayfasından oluşturulan randevu - ${storeName}`,
      userId: providerUserId,
      businessId: effectiveBusinessId,
      createdBy: providerUserId
    };

    const appointment = new Appointment(appointmentData);
    await appointment.save();

    try {
      const planQuotaMapInc = { plus: 200, pro: 400, premium: null };
      const effectiveMonthlyQuotaInc = planQuotaMapInc[storeOwner.planType] ?? storeOwner.monthlyQuota ?? null;
      const shouldIncrement = !!storeOwner.isPremium && effectiveMonthlyQuotaInc != null;
      if (shouldIncrement) {
        await User.findByIdAndUpdate(storeOwner._id, { $inc: { usedAppointmentsThisMonth: 1 }, lastResetAt: storeOwner.lastResetAt || new Date() });
      }
    } catch (incErr) {}

    res.status(201).json({ message: 'Randevu başarıyla oluşturuldu', appointment });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mağaza için müsait saatleri getir
router.get('/:storeName/available-slots', async (req, res) => {
  try {
    const { storeName } = req.params;
    const { date, serviceId, serviceName, staffId } = req.query;

    if (!storeName || !date || (!serviceId && !serviceName)) {
      return res.status(400).json({ error: 'Mağaza adı, tarih ve hizmet (ID veya isim) gerekli' });
    }

    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    }).populate('businessId');

    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    if (!storeOwner.businessId) {
      return res.status(400).json({ error: 'İşletme bilgisi bulunamadı' });
    }

    let service = null;
    let serviceCreatorId = null;

    if (storeOwner.services && Array.isArray(storeOwner.services)) {
      const ownerService = storeOwner.services.find(s => {
        const sid = (typeof s === 'object' && s !== null) ? (s.id || s._id) : s;
        return serviceId && sid && sid.toString() === serviceId;
      });
      if (ownerService) {
        service = ownerService;
        serviceCreatorId = storeOwner._id;
      }
    }

    const business = storeOwner.businessId;
    const staffUsers = await User.find({ userType: 'staff', businessId: business._id }).select('name services workingHours');

    if (!service && Array.isArray(staffUsers) && staffUsers.length > 0) {
      for (const su of staffUsers) {
        if (su.services && Array.isArray(su.services)) {
          const staffService = su.services.find(s => {
            const sid = (typeof s === 'object' && s !== null) ? (s.id || s._id) : s;
            return serviceId && sid && sid.toString() === serviceId;
          });
          if (staffService) {
            service = staffService;
            serviceCreatorId = su._id;
            break;
          }
        }
      }
    }

    if (!service && serviceName) {
      const normName = String(serviceName).trim().toLowerCase();
      if (storeOwner.services && Array.isArray(storeOwner.services)) {
        const ownerServiceByName = storeOwner.services.find(s => {
          const sname = (typeof s === 'object' && s !== null) ? (s.name || '') : String(s || '');
          return sname.trim().toLowerCase() === normName;
        });
        if (ownerServiceByName) {
          service = ownerServiceByName;
          serviceCreatorId = storeOwner._id;
        }
      }
      if (!service && Array.isArray(staffUsers) && staffUsers.length > 0) {
        for (const su of staffUsers) {
          if (su.services && Array.isArray(su.services)) {
            const staffServiceByName = su.services.find(s => {
              const sname = (typeof s === 'object' && s !== null) ? (s.name || '') : String(s || '');
              return sname.trim().toLowerCase() === normName;
            });
            if (staffServiceByName) {
              service = staffServiceByName;
              serviceCreatorId = su._id;
              break;
            }
          }
        }
      }
    }

    if (!service) {
      return res.status(404).json({ error: 'Hizmet bulunamadı' });
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const providerUserId = (staffId && staffId !== 'all') ? staffId : (serviceCreatorId ? serviceCreatorId : storeOwner._id);

    const existingAppointments = await Appointment.find({
      businessId: storeOwner.businessId._id,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: 'cancelled' },
      userId: providerUserId
    });

    const blockedTimes = await BlockedTime.find({
      businessId: storeOwner.businessId._id,
      date: { $gte: startOfDay, $lte: endOfDay },
      userId: providerUserId
    });

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayName = dayNames[new Date(date).getDay()];

    const isValidSchedule = (s) => s && !s.isClosed && typeof s.start === 'string' && s.start.includes(':') && typeof s.end === 'string' && s.end.includes(':');

    let daySchedule = null;

    if (providerUserId && providerUserId.toString() === storeOwner._id.toString()) {
      const ownerHours = storeOwner.workingHours || null;
      const bizHours = storeOwner.businessId ? storeOwner.businessId.workingHours : null;
      daySchedule = ownerHours ? ownerHours[dayName] : null;
      if (!isValidSchedule(daySchedule) && bizHours) daySchedule = bizHours[dayName];
    } else {
      const staff = Array.isArray(staffUsers) ? staffUsers.find(s => s._id.toString() === providerUserId.toString()) : null;
      const staffHours = staff && staff.workingHours ? staff.workingHours : null;
      daySchedule = staffHours ? staffHours[dayName] : null;
    }

    if (!isValidSchedule(daySchedule)) {
      return res.json({ availableSlots: [] });
    }

    const startStr = daySchedule.start;
    const endStr = daySchedule.end;
    const serviceDuration = (typeof service === 'object' && service !== null) ? (Number(service.duration) || 60) : 60;
    const availableSlots = [];

    const [startHour, startMinute] = startStr.split(':').map(Number);
    const [endHour, endMinute] = endStr.split(':').map(Number);

    let currentTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    const toMinutes = (t) => {
      if (!t || typeof t !== 'string') return null;
      const parts = t.split(':');
      if (parts.length !== 2) return null;
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    };

    while (currentTime + serviceDuration <= endTime) {
      const hour = Math.floor(currentTime / 60);
      const minute = currentTime % 60;
      const timeSlot = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

      const candStart = currentTime;
      const candEnd = currentTime + serviceDuration;

      const overlapsAppointment = existingAppointments.some(apt => {
        const aptStart = toMinutes(apt.startTime);
        const aptEnd = toMinutes(apt.endTime);
        if (aptStart == null || aptEnd == null) return false;
        return aptEnd > candStart && candEnd > aptStart;
      });

      const overlapsBlocked = blockedTimes.some(bt => {
        const btStart = toMinutes(bt.startTime);
        const btEnd = toMinutes(bt.endTime);
        if (btStart == null || btEnd == null) return false;
        return btEnd > candStart && candEnd > btStart;
      });

      if (!overlapsAppointment && !overlapsBlocked) availableSlots.push(timeSlot);
      currentTime += 30;
    }

    res.json({ availableSlots });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Public personel listesi
router.get('/:storeName/staff', async (req, res) => {
  try {
    const { storeName } = req.params;
    if (!storeName) return res.status(400).json({ error: 'Mağaza adı gerekli' });

    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    });
    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    const staffUsers = await User.find({ userType: 'staff', businessId: storeOwner.businessId }).select('name services workingHours');

    const ownerEntry = {
      id: storeOwner._id,
      name: 'İşletme Sahibi',
      isOwner: true,
      specialties: [],
      services: Array.isArray(storeOwner.services)
        ? storeOwner.services.filter(s => s.showInStore !== false).map(s => ({
            id: s.id || s._id || undefined,
            name: s.name,
            duration: s.duration,
            price: s.price,
            showInStore: s.showInStore !== false
          }))
        : []
    };

    const staff = [ownerEntry, ...(staffUsers || []).map(u => ({
      id: u._id,
      name: u.name,
      isOwner: false,
      specialties: [],
      services: Array.isArray(u.services)
        ? u.services.filter(s => s.showInStore !== false).map(s => ({
            id: s.id || s._id || undefined,
            name: s.name,
            duration: s.duration,
            price: s.price,
            showInStore: s.showInStore !== false
          }))
        : []
    }))];

    res.json({ staff });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mağaza randevularını getir (takvim için)
router.get('/:storeName/appointments', async (req, res) => {
  try {
    const { storeName } = req.params;
    const { staffId, startDate, endDate } = req.query;
    if (!storeName) return res.status(400).json({ error: 'Mağaza adı gerekli' });

    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    });
    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }
    if (!storeOwner.businessId) return res.status(404).json({ error: 'İşletme bilgileri bulunamadı' });

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const query = {
      businessId: storeOwner.businessId,
      date: { $gte: start, $lte: end },
      status: { $ne: 'cancelled' }
    };
    if (staffId && staffId !== 'all') query.staffId = staffId;

    const appointments = await Appointment.find(query).sort({ date: 1, time: 1 });
    const publicAppointments = appointments.map(apt => ({
      id: apt._id,
      date: apt.date,
      time: apt.time,
      duration: apt.duration || 60,
      service: apt.service,
      staffId: apt.staffId || null,
      staffName: apt.staffName || 'Belirtilmedi',
      status: apt.status,
      isBooked: true
    }));

    res.json({ appointments: publicAppointments });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Mağaza çalışma saatlerini getir
router.get('/:storeName/working-hours', async (req, res) => {
  try {
    const { storeName } = req.params;
    const { staffId, serviceId } = req.query;
    if (!storeName) return res.status(400).json({ error: 'Mağaza adı gerekli' });

    const storeOwner = await User.findOne({
      'storeSettings.enabled': true,
      'storeSettings.storeName': storeName.trim()
    }).populate('businessId');
    if (!storeOwner || !storeOwner.storeSettings || !storeOwner.storeSettings.enabled) {
      return res.status(404).json({ error: 'Mağaza bulunamadı veya aktif değil' });
    }

    const business = storeOwner.businessId;
    let workingHours = null;
    let serviceCreatorId = null;

    if (staffId && staffId !== 'all') {
      const staff = await User.findById(staffId).select('workingHours services');
      if (staff && staff.workingHours) {
        workingHours = staff.workingHours;
      }
    } else {
      if (serviceId) {
        const ownerService = (storeOwner.services || []).find(s => {
          const sid = (typeof s === 'object' && s !== null) ? (s.id || s._id) : s;
          return sid && sid.toString() === String(serviceId);
        });
        if (ownerService) {
          workingHours = storeOwner.workingHours;
          serviceCreatorId = storeOwner._id;
        } else if (business) {
          const staffUsers = await User.find({ userType: 'staff', businessId: business._id }).select('workingHours services');
          for (const su of staffUsers) {
            const s = (su.services || []).find(x => {
              const sid = (typeof x === 'object' && x !== null) ? (x.id || x._id) : x;
              return sid && sid.toString() === String(serviceId);
            });
            if (s) {
              workingHours = su.workingHours;
              serviceCreatorId = su._id;
              break;
            }
          }
        }
      } else {
        workingHours = storeOwner.workingHours || (business && business.workingHours) || {};
      }
    }

    if (!workingHours) workingHours = {};
    res.json({ workingHours, serviceCreatorId });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// Basit randevu talebi endpoint’i
router.post('/:storeName/appointment-request', async (req, res) => {
  try {
    const { storeName } = req.params;
    const { firstName, lastName, phone, serviceName, serviceId } = req.body;

    if (!firstName || !lastName || !phone) {
      return res.status(400).json({ error: 'Ad, soyad ve telefon alanları zorunludur.' });
    }

    const storeOwner = await User.findOne({
      'storeSettings.storeName': { $regex: new RegExp(`^${storeName}$`, 'i') }
    });

    if (!storeOwner) {
      return res.status(404).json({ error: 'Mağaza bulunamadı' });
    }

    const appointmentRequestData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      serviceName: serviceName || 'Genel Randevu',
      storeName: storeName,
      storeOwnerId: storeOwner._id,
      status: 'pending',
      notes: `Randevu talebi - ${firstName} ${lastName} (${phone}) - ${serviceName || 'Genel Randevu'}`
    };

    if (serviceId && mongoose.Types.ObjectId.isValid(serviceId)) {
      appointmentRequestData.serviceId = serviceId;
    }

    const appointmentRequest = new AppointmentRequest(appointmentRequestData);
    await appointmentRequest.save();

    res.status(201).json({ 
      message: 'Randevu talebiniz başarıyla alındı. En kısa sürede sizinle iletişime geçeceğiz.',
      requestId: appointmentRequest._id
    });
  } catch (error) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

module.exports = router;
