// eventRoutes.js
// Mount in your main server file with:  app.use(require('./eventRoutes'));
// Make sure express.json() is applied before this router:  app.use(express.json());

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// ---- Config ---------------------------------------------------------------
// Optional venue check. Set these env vars on Render to enforce a radius.
// If EVENT_LAT / EVENT_LNG are not set, location is recorded but not enforced.
const VENUE_LAT = parseFloat(process.env.EVENT_LAT);
const VENUE_LNG = parseFloat(process.env.EVENT_LNG);
const VENUE_RADIUS_M = parseFloat(process.env.EVENT_RADIUS_M) || 200;
const ENFORCE_VENUE = !isNaN(VENUE_LAT) && !isNaN(VENUE_LNG);

// NOTE: Render's free-tier disk is wiped on every deploy/restart.
// For permanent storage, swap saveSubmission() for a database call
// (MongoDB Atlas, Supabase, Google Sheets API, etc.).
const DATA_FILE = path.join(__dirname, 'event-attendance.jsonl');

// ---- Helpers --------------------------------------------------------------
function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const clean = (v, max = 100) =>
  typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';

function readSubmissions() {
  if (!fs.existsSync(DATA_FILE)) return [];
  return fs
    .readFileSync(DATA_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function saveSubmission(record) {
  fs.appendFileSync(DATA_FILE, JSON.stringify(record) + '\n');
}

// ---- Routes ---------------------------------------------------------------
router.get('/event', (req, res) => {
  res.sendFile(path.join(__dirname, 'event.html'));
});

router.post('/api/event-attendance', (req, res) => {
  const b = req.body || {};
  const errors = {};

  // Section 1: mandatory
  const name = clean(b.name);
  const prn = clean(b.prn, 30).toUpperCase();
  const department = clean(b.department);
  const year = clean(b.year, 20);
  const phone = clean(b.phone, 20).replace(/[\s-]/g, '');

  if (name.length < 2) errors.name = 'Enter your full name.';
  if (!/^[A-Z0-9]{5,20}$/.test(prn)) errors.prn = 'Enter a valid PRN (letters and digits only).';
  if (!department) errors.department = 'Enter your department.';
  if (!['FY', 'SY', 'TY', 'BTech', '1', '2', '3', '4'].includes(year) && !year)
    errors.year = 'Select your year of study.';
  if (!/^(\+91)?[6-9]\d{9}$/.test(phone)) errors.phone = 'Enter a valid 10-digit mobile number.';

  // Location
  const lat = Number(b.location && b.location.latitude);
  const lng = Number(b.location && b.location.longitude);
  const accuracy = Number(b.location && b.location.accuracy);
  const hasLocation =
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(b.location.latitude === null || b.location.longitude === null);

  let distanceFromVenue = null;
  if (!hasLocation) {
    errors.location = 'Location is required. Allow location access and try again.';
  } else if (ENFORCE_VENUE) {
    distanceFromVenue = Math.round(haversineMeters(lat, lng, VENUE_LAT, VENUE_LNG));
    if (distanceFromVenue > VENUE_RADIUS_M) {
      errors.location = `You appear to be about ${distanceFromVenue} m from the venue. Attendance must be marked at the event.`;
    }
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ success: false, message: 'Please fix the highlighted fields.', errors });
  }

  // Duplicate check (one submission per PRN)
  if (readSubmissions().some((s) => s.prn === prn)) {
    return res.status(409).json({
      success: false,
      message: 'Attendance for this PRN is already recorded.',
      errors: { prn: 'Already marked present.' },
    });
  }

  // Section 2: optional (only for students leaving a lecture)
  const record = {
    submittedAt: new Date().toISOString(),
    name, prn, department, year, phone,
    leavingLecture: {
      rollNo: clean(b.rollNo, 20),
      batch: clean(b.batch, 20),
      facultyName: clean(b.facultyName),
      subject: clean(b.subject),
    },
    location: { latitude: lat, longitude: lng, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null, distanceFromVenue },
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
  };

  try {
    saveSubmission(record);
    console.log('[event-attendance]', record.prn, record.name);
    return res.json({ success: true, message: 'Attendance recorded. Thank you!' });
  } catch (err) {
    console.error('Failed to save event attendance:', err);
    return res.status(500).json({ success: false, message: 'Could not save your attendance. Please try again.' });
  }
});

module.exports = router;
