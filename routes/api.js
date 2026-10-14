const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { predictStudent } = require('../utils/aiPredictions');

// ─── HELPER FUNCTIONS ─────────────────────────────────────────

// Generate UUID v4
function uuidv4() {
  return crypto.randomUUID();
}

// Execute query helper
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Get single row
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Log the real error on the server; only show its details to the browser in development
function serverError(req, res, err) {
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  res.json({
    success: false,
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong. Please try again.'
  });
}

// ─── HELPER: Local (South African) dates as 'YYYY-MM-DD' ────
// toISOString() would give the UTC date, which is yesterday between 00:00 and 02:00 SAST
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfMonth() {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────
function auth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  next();
}

function adminOnly(req, res, next) {
  if (!req.session?.user || !['admin', 'super_admin'].includes(req.session.user.role))
    return res.status(403).json({ success: false, error: 'Admin access required' });
  next();
}

function instructorOnly(req, res, next) {
  if (!req.session?.user || req.session.user.role !== 'instructor')
    return res.status(403).json({ success: false, error: 'Instructor access required' });
  next();
}

// ─── HELPER: Skill ratings ──────────────────────────────────
// Instructors can rate these per lesson (0–100); stored in lessons.areas_covered as JSON
const SKILL_AREAS = [
  { key: 'vehicle_control', label: 'Vehicle Control' },
  { key: 'road_awareness', label: 'Road Awareness' },
  { key: 'parking_yard', label: 'Parking & Yard' },
  { key: 'observation', label: 'Observation' },
  { key: 'k53_rules', label: 'K53 Rules' }
];

// Keep only known skills with whole-number scores 0–100; null if none were given
function parseSkillScores(input) {
  if (!input || typeof input !== 'object') return null;
  const scores = {};
  for (const { key } of SKILL_AREAS) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    const n = Math.round(Number(value));
    if (Number.isFinite(n) && n >= 0 && n <= 100) scores[key] = n;
  }
  return Object.keys(scores).length ? scores : null;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

// Average each skill across a student's completed lessons that rated it
function summariseSkills(lessons) {
  return SKILL_AREAS.map(({ key, label }) => {
    const values = lessons
      .filter(l => l.status === 'completed')
      .map(l => parseJson(l.areas_covered)?.[key])
      .filter(v => typeof v === 'number');
    return {
      key, label,
      score: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
      assessments: values.length
    };
  });
}

// Strip credential fields before sending a profile row to the browser
function safeProfile(profile) {
  const { password_hash, reset_token_hash, reset_token_expires, ...rest } = profile;
  return rest;
}

function temporaryPassword() {
  return `Xolani-${Math.random().toString(36).slice(2, 8)}${Math.floor(1000 + Math.random() * 9000)}!`;
}

// ─── HELPER: Get instructor record ──────────────────────────
async function getInstructorRecord(userId) {
  const row = await queryOne(
    `SELECT i.*, b.name as branch_name 
     FROM instructors i
     LEFT JOIN branches b ON i.branch_id = b.id
     WHERE i.profile_id = ?`,
    [userId]
  );
  return row;
}

// ─── HELPER: Get instructor lessons ─────────────────────────
async function getInstructorLessons(userId, opts = {}) {
  const instructor = await getInstructorRecord(userId);
  const ids = [userId, instructor?.id].filter(Boolean);
  
  let sql = `
    SELECT 
      l.*,
      CONCAT(p.first_name, ' ', p.last_name) as student_name,
      p.phone as student_phone,
      CONCAT(v.make, ' ', v.model, ' (', v.registration_number, ')') as vehicle,
      b.name as branch_name
    FROM lessons l
    LEFT JOIN profiles p ON l.student_id = p.id
    LEFT JOIN vehicles v ON l.vehicle_id = v.id
    LEFT JOIN branches b ON l.branch_id = b.id
    WHERE l.instructor_id IN (?)
  `;
  
  const params = [ids];
  
  if (opts.fromDate) {
    sql += ' AND l.scheduled_date >= ?';
    params.push(opts.fromDate);
  }
  if (opts.date) {
    sql += ' AND l.scheduled_date = ?';
    params.push(opts.date);
  }
  
  sql += ' ORDER BY l.scheduled_date ASC, l.scheduled_time ASC';
  
  const lessons = await query(sql, params);
  
  return {
    instructor,
    lessons: lessons.map(l => ({
      ...l,
      student_name: l.student_name,
      student_phone: l.student_phone,
      vehicle: l.vehicle,
      branch_name: l.branch_name
    }))
  };
}

// ─── HELPER: Readiness + dropout predictions ────────────────
// Returns { [studentId]: { testReadiness, dropoutRisk } } built from real records
async function getStudentPredictions(studentIds) {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const [profiles, lessons, enrollments] = await Promise.all([
    query('SELECT id, created_at FROM profiles WHERE id IN (?)', [ids]),
    query(
      `SELECT student_id, status, lesson_type, scheduled_date, student_score
       FROM lessons WHERE student_id IN (?)`,
      [ids]
    ),
    query(
      `SELECT e.student_id, e.start_date, e.total_paid, e.balance_due, pkg.lesson_count
       FROM enrollments e
       LEFT JOIN packages pkg ON e.package_id = pkg.id
       WHERE e.student_id IN (?) AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [ids]
    )
  ]);

  const createdAt = {};
  profiles.forEach(p => { createdAt[p.id] = p.created_at; });
  const lessonsBy = {};
  lessons.forEach(l => { (lessonsBy[l.student_id] ||= []).push(l); });
  const enrollmentBy = {};
  enrollments.forEach(e => { if (!enrollmentBy[e.student_id]) enrollmentBy[e.student_id] = e; });

  const predictions = {};
  ids.forEach(id => {
    predictions[id] = predictStudent({
      lessons: lessonsBy[id] || [],
      enrollment: enrollmentBy[id] || null,
      createdAt: createdAt[id]
    });
  });
  return predictions;
}

// ─── HELPER: Normalize branch name ──────────────────────────
function normalizeBranchName(name) {
  if (!name) return name;
  return name.replace(/Durban North/i, 'Umlazi V').replace(/Pinetown/i, 'Umlazi W');
}

// ─── HELPER: Operating Hours ────────────────────────────────
function isBranchOpen(dateStr, timeStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = date.getDay();
  const hour = parseInt(timeStr.split(':')[0]);
  
  if (dayOfWeek === 0) return { open: false, reason: 'Sunday - Branch Closed' };
  
  if (dayOfWeek === 6) {
    if (hour < 7 || hour >= 18) {
      return { open: false, reason: 'Saturday operating hours: 7:00 AM - 6:00 PM' };
    }
    return { open: true };
  }
  
  if (hour < 7 || hour >= 18) {
    return { open: false, reason: 'Operating hours: 7:00 AM - 6:00 PM (Monday-Friday)' };
  }
  
  return { open: true };
}

// ─── HELPER: Public Holidays ────────────────────────────────
function isPublicHoliday(dateStr) {
  const publicHolidays = [
    '2026-01-01', '2026-03-21', '2026-04-03', '2026-04-06',
    '2026-04-27', '2026-05-01', '2026-06-16', '2026-08-10',
    '2026-09-24', '2026-12-16', '2026-12-25', '2026-12-26'
  ];
  return publicHolidays.includes(dateStr);
}

// ════════════════════════════════════════════════════════════
// CONTACT FORM (public)
// ════════════════════════════════════════════════════════════
router.post('/contact', async (req, res) => {
  try {
    const { name, email, phone, subject, message, branch } = req.body;
    if (!name || !email || !message) {
      return res.json({ success: false, error: 'Name, email and message are required.' });
    }
    
    await query(
      `INSERT INTO contact_submissions (id, name, email, phone, subject, message, branch_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), name, email, phone || null, subject || null, message, null]
    );
    
    res.json({ success: true, message: 'Thank you! We will get back to you within 24 hours.' });
  } catch (err) {
    console.error('Contact error:', err.message);
    res.json({ success: false, error: 'Failed to send message. Please try again.' });
  }
});

// ════════════════════════════════════════════════════════════
// STUDENT APIs
// ════════════════════════════════════════════════════════════

// Dashboard
router.get('/student/dashboard', auth, async (req, res) => {
  try {
    const sid = req.session.user.id;
    
    // Get enrollment
    const enrollment = await queryOne(
      `SELECT e.*, p.name as package_name, p.lesson_count 
       FROM enrollments e
       LEFT JOIN packages p ON e.package_id = p.id
       WHERE e.student_id = ? AND e.status = 'active'`,
      [sid]
    );
    
    // Get upcoming lessons
    const upcomingLessons = await query(
      `SELECT l.*, CONCAT(p.first_name, ' ', p.last_name) as instructor_name
       FROM lessons l
       LEFT JOIN profiles p ON l.instructor_id = p.id
       WHERE l.student_id = ? 
         AND l.scheduled_date >= CURDATE() 
         AND l.status IN ('scheduled', 'in_progress')
       ORDER BY l.scheduled_date ASC
       LIMIT 5`,
      [sid]
    );
    
    // Get notifications
    const notifications = await query(
      `SELECT * FROM notifications 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT 6`,
      [sid]
    );
    
    // Get recent payments
    const recentPayments = await query(
      `SELECT * FROM payments 
       WHERE student_id = ? 
       ORDER BY payment_date DESC 
       LIMIT 4`,
      [sid]
    );
    
    // Get all lessons for stats
    const allLessons = await query(
      `SELECT status, student_score, attendance_method FROM lessons WHERE student_id = ?`,
      [sid]
    );
    
    const completed = allLessons.filter(l => l.status === 'completed');
    const scores = completed.filter(l => l.student_score != null).map(l => l.student_score);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

    const ai = (await getStudentPredictions([sid]))[sid];
    const attRate = ai.testReadiness.breakdown.attendanceRate;
    
    res.json({
      success: true,
      user: req.session.user,
      stats: {
        lessonsCompleted: completed.length,
        lessonsRemaining: enrollment?.lessons_remaining || 0,
        attendanceRate: attRate,
        avgScore
      },
      enrollment: enrollment ? {
        packageName: enrollment.package_name,
        status: enrollment.status,
        lessonsCompleted: enrollment.lessons_completed,
        totalLessons: enrollment.lesson_count,
        endDate: enrollment.end_date,
        balanceDue: enrollment.balance_due
      } : null,
      upcomingLessons: upcomingLessons || [],
      notifications: notifications || [],
      recentPayments: recentPayments || [],
      aiReadiness: ai.testReadiness,
      dropoutRisk: ai.dropoutRisk
    });
  } catch (err) {
    console.error('Student dashboard error:', err.message);
    serverError(req, res, err);
  }
});

// Lessons
router.get('/student/lessons', auth, async (req, res) => {
  try {
    const sid = req.session.user.id;
    
    const lessons = await query(
      `SELECT 
        l.*,
        CONCAT(p.first_name, ' ', p.last_name) as instructor_name,
        CONCAT(v.make, ' ', v.model, ' (', v.registration_number, ')') as vehicle,
        b.name as branch_name
       FROM lessons l
       LEFT JOIN profiles p ON l.instructor_id = p.id
       LEFT JOIN vehicles v ON l.vehicle_id = v.id
       LEFT JOIN branches b ON l.branch_id = b.id
       WHERE l.student_id = ?
       ORDER BY l.scheduled_date DESC, l.scheduled_time DESC`,
      [sid]
    );
    
    res.json({
      success: true,
      user: req.session.user,
      lessons: lessons || []
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Student Cancel Lesson
router.post('/student/lessons/:id/cancel', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.session.user.id;
    
    const lesson = await queryOne(
      'SELECT * FROM lessons WHERE id = ?',
      [id]
    );
    
    if (!lesson) {
      return res.json({ success: false, error: 'Lesson not found.' });
    }
    
    if (lesson.student_id !== studentId) {
      return res.json({ success: false, error: 'You are not authorized to cancel this lesson.' });
    }
    
    if (lesson.status !== 'scheduled') {
      return res.json({ success: false, error: 'Only scheduled lessons can be cancelled.' });
    }
    
    await query(
      'UPDATE lessons SET status = ? WHERE id = ?',
      ['cancelled', id]
    );
    
    await query(
      `INSERT INTO notifications (id, user_id, title, message, type, action_url) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), lesson.instructor_id, '❌ Lesson Cancelled',
       `${req.session.user.firstName} has cancelled their lesson scheduled for ${lesson.scheduled_date} at ${lesson.scheduled_time}.`,
       'warning', '/instructor/dashboard.html']
    );
    
    res.json({ success: true, message: 'Lesson cancelled successfully.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Attendance
router.get('/student/attendance', auth, async (req, res) => {
  try {
    const sid = req.session.user.id;
    
    const lessons = await query(
      `SELECT 
        l.*,
        CONCAT(p.first_name, ' ', p.last_name) as instructor_name
       FROM lessons l
       LEFT JOIN profiles p ON l.instructor_id = p.id
       WHERE l.student_id = ?
       ORDER BY l.scheduled_date DESC, l.scheduled_time DESC`,
      [sid]
    );
    
    const all = lessons || [];
    const present = all.filter(l => l.status === 'completed').length;
    const absent = all.filter(l => l.status === 'no_show').length;
    const qrScans = all.filter(l => l.attendance_method === 'qr').length;
    const attRate = all.length ? Math.round((present / all.length) * 100) : 0;
    
    res.json({
      success: true,
      user: req.session.user,
      attendance: all,
      stats: { totalLessons: all.length, present, absent, qrScans, attendanceRate: attRate }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Progress
router.get('/student/progress', auth, async (req, res) => {
  try {
    const sid = req.session.user.id;
    
    const enrollment = await queryOne(
      `SELECT e.*, p.name as package_name, p.lesson_count 
       FROM enrollments e
       LEFT JOIN packages p ON e.package_id = p.id
       WHERE e.student_id = ? AND e.status = 'active'`,
      [sid]
    );
    
    const lessons = await query(
      `SELECT 
        l.*,
        CONCAT(prof.first_name, ' ', prof.last_name) as instructor_name
       FROM lessons l
       LEFT JOIN profiles prof ON l.instructor_id = prof.id
       WHERE l.student_id = ?
       ORDER BY l.scheduled_date DESC`,
      [sid]
    );
    
    const completed = (lessons || []).filter(l => l.status === 'completed');
    const scores = completed.filter(l => l.student_score != null).map(l => l.student_score);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const bestScore = scores.length ? Math.max(...scores) : 0;
    const improvement = scores.length >= 2 ? scores[scores.length - 1] - scores[0] : null;
    const ai = (await getStudentPredictions([sid]))[sid];
    const attRate = ai.testReadiness.breakdown.attendanceRate;
    
    res.json({
      success: true,
      user: req.session.user,
      enrollment: enrollment ? {
        packageName: enrollment.package_name,
        startDate: enrollment.start_date,
        endDate: enrollment.end_date,
        lessonsCompleted: enrollment.lessons_completed || completed.length,
        totalLessons: enrollment.lesson_count || 10
      } : null,
      completedLessons: completed,
      avgScore,
      bestScore,
      improvement,
      attendanceRate: attRate,
      skills: summariseSkills(lessons || []),
      testReadiness: ai.testReadiness,
      dropoutRisk: ai.dropoutRisk
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Payments
router.get('/student/payments', auth, async (req, res) => {
  try {
    const sid = req.session.user.id;
    
    const payments = await query(
      'SELECT * FROM payments WHERE student_id = ? ORDER BY payment_date DESC',
      [sid]
    );
    
    const enrollment = await queryOne(
      `SELECT e.total_paid, e.balance_due, e.status, p.name as package_name
       FROM enrollments e
       LEFT JOIN packages p ON e.package_id = p.id
       WHERE e.student_id = ?
       ORDER BY e.created_at DESC
       LIMIT 1`,
      [sid]
    );
    
    res.json({
      success: true,
      user: req.session.user,
      payments: payments || [],
      totalPaid: enrollment?.total_paid || 0,
      balanceDue: enrollment?.balance_due || 0,
      packageName: enrollment?.package_name,
      enrollmentStatus: enrollment?.status
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Notifications
router.get('/student/notifications', auth, async (req, res) => {
  try {
    const notifications = await query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
      [req.session.user.id]
    );
    res.json({ success: true, user: req.session.user, notifications: notifications || [] });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Mark notification read
router.post('/notifications/:id/read', auth, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = true WHERE id = ? AND user_id = ?',
      [req.params.id, req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// Mark all read
router.post('/notifications/mark-all-read', auth, async (req, res) => {
  try {
    await query(
      'UPDATE notifications SET is_read = true WHERE user_id = ? AND is_read = false',
      [req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// Unread count
router.get('/notifications/unread-count', auth, async (req, res) => {
  try {
    const rows = await query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = false',
      [req.session.user.id]
    );
    res.json({ count: rows[0]?.count || 0 });
  } catch (err) {
    res.json({ count: 0 });
  }
});

// Profile GET
router.get('/student/profile', auth, async (req, res) => {
  try {
    const profile = await queryOne(
      `SELECT p.*, b.name as branch_name 
       FROM profiles p
       LEFT JOIN branches b ON p.branch_id = b.id
       WHERE p.id = ?`,
      [req.session.user.id]
    );
    res.json({ success: true, profile: { ...profile, email: req.session.user.email } });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Profile PUT
router.put('/student/profile', auth, async (req, res) => {
  try {
    const { first_name, last_name, phone, address, city, emergency_contact_name, emergency_contact_phone } = req.body;
    
    await query(
      `UPDATE profiles 
       SET first_name = ?, last_name = ?, phone = ?, address = ?, city = ?,
           emergency_contact_name = ?, emergency_contact_phone = ?
       WHERE id = ?`,
      [first_name, last_name, phone, address, city, emergency_contact_name, emergency_contact_phone, req.session.user.id]
    );
    
    if (first_name) {
      req.session.user.firstName = first_name;
      req.session.user.lastName = last_name || req.session.user.lastName;
      req.session.user.fullName = `${first_name} ${last_name || req.session.user.lastName}`.trim();
    }
    
    res.json({ success: true, message: 'Profile updated successfully.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ════════════════════════════════════════════════════════════
// QR Code Scan
// ════════════════════════════════════════════════════════════
router.get('/student/scan-qr/:token', auth, async (req, res) => {
  try {
    const { token } = req.params;
    const sid = req.session.user.id;
    
    const lesson = await queryOne(
      'SELECT * FROM lessons WHERE qr_code_token = ?',
      [token]
    );
    
    if (!lesson) {
      return res.json({ success: false, error: 'Invalid QR code. Please ask your instructor for a new one.' });
    }
    
    if (lesson.student_id !== sid) {
      return res.json({ success: false, error: 'This QR code does not belong to your lesson.' });
    }
    
    if (lesson.attendance_marked_at) {
      return res.json({ success: true, alreadyMarked: true, message: 'Attendance was already recorded for this lesson.', lesson });
    }
    
    const now = new Date();
    const lessonDT = new Date(`${lesson.scheduled_date}T${lesson.scheduled_time}`);
    const diffMins = Math.abs(now - lessonDT) / 60000;
    
    // Check if it's too early (more than 30 minutes before lesson)
    if (now < lessonDT) {
      const minsUntilStart = Math.round((lessonDT - now) / 60000);
      if (minsUntilStart > 30) {
        return res.json({
          success: false,
          error: `⚠️ This QR code is for a lesson on ${lesson.scheduled_date} at ${lesson.scheduled_time}. Please wait until your lesson time. (${minsUntilStart} minutes until start)`,
          tooEarly: true,
          scheduled_date: lesson.scheduled_date,
          scheduled_time: lesson.scheduled_time
        });
      }
    }
    
    // Check if it's too late (more than 3 hours after lesson)
    if (diffMins > 180) {
      return res.json({ success: false, error: 'QR code has expired. Attendance can only be marked within 3 hours of lesson time.' });
    }
    
    // Mark attendance
    await query(
      'UPDATE lessons SET status = ?, attendance_marked_at = NOW(), attendance_method = ? WHERE id = ?',
      ['in_progress', 'qr', lesson.id]
    );
    
    await query(
      `INSERT INTO notifications (id, user_id, title, message, type) 
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), sid, 'Attendance Recorded ✅',
       `Your attendance for lesson on ${lesson.scheduled_date} at ${lesson.scheduled_time} has been recorded via QR code.`,
       'success']
    );
    
    res.json({
      success: true,
      message: 'Attendance recorded successfully!',
      lesson,
      timeUntilStart: now < lessonDT ? Math.round((lessonDT - now) / 60000) : 0
    });
  } catch (err) {
    console.error('QR scan error:', err.message);
    res.json({ success: false, error: 'Error processing QR code.' });
  }
});

// ════════════════════════════════════════════════════════════
// ADMIN APIs
// ════════════════════════════════════════════════════════════

// Admin Dashboard
router.get('/admin/dashboard', auth, adminOnly, async (req, res) => {
  try {
    const today = localDate();
    const monthStart = startOfMonth();
    
    // Get counts
    const totalStudents = await queryOne(
      'SELECT COUNT(*) as count FROM profiles WHERE role = ?',
      ['student']
    );
    
    const activeEnrollments = await queryOne(
      "SELECT COUNT(*) as count FROM enrollments WHERE status = 'active'"
    );
    
    const todayLessons = await queryOne(
      'SELECT COUNT(*) as count FROM lessons WHERE scheduled_date = ?',
      [today]
    );
    
    // Recent students
    const recentStudents = await query(
      'SELECT id, first_name, last_name, created_at FROM profiles WHERE role = ? ORDER BY created_at DESC LIMIT 5',
      ['student']
    );
    
    // Today's lessons with details
    const todayLessonData = await query(
      `SELECT 
        l.id, l.scheduled_time, l.scheduled_date, l.status, l.lesson_type, l.qr_code_token,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.phone as student_phone,
        CONCAT(i.first_name, ' ', i.last_name) as instructor_name
       FROM lessons l
       LEFT JOIN profiles s ON l.student_id = s.id
       LEFT JOIN profiles i ON l.instructor_id = i.id
       WHERE l.scheduled_date = ?
       ORDER BY l.scheduled_time ASC
       LIMIT 8`,
      [today]
    );
    
    // Recent payments
    const recentPayments = await query(
      `SELECT p.*, CONCAT(prof.first_name, ' ', prof.last_name) as student_name
       FROM payments p
       LEFT JOIN profiles prof ON p.student_id = prof.id
       ORDER BY p.payment_date DESC
       LIMIT 5`
    );
    
    // Month revenue
    const monthPayments = await query(
      'SELECT amount FROM payments WHERE status = ? AND payment_date >= ?',
      ['completed', monthStart]
    );
    
    const monthRevenue = monthPayments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const totalStudentsCount = totalStudents?.count || 0;
    const todayLessonsCount = todayLessons?.count || 0;

    // Per-branch students and today's lessons
    const branches = await query(
      `SELECT b.id, b.name,
         (SELECT COUNT(*) FROM profiles p WHERE p.branch_id = b.id AND p.role = 'student' AND p.is_active = TRUE) AS students,
         (SELECT COUNT(*) FROM lessons l WHERE l.branch_id = b.id AND l.scheduled_date = ?) AS today_lessons
       FROM branches b ORDER BY b.name`,
      [today]
    );

    // Readiness / dropout summary across active students
    const activeStudents = await query("SELECT id FROM profiles WHERE role = 'student' AND is_active = TRUE");
    const predictions = Object.values(await getStudentPredictions(activeStudents.map(s => s.id)));
    
    res.json({
      success: true,
      user: req.session.user,
      stats: {
        totalStudents: totalStudentsCount,
        activeEnrollments: activeEnrollments?.count || 0,
        todayLessons: todayLessonsCount,
        monthRevenue: monthRevenue.toFixed(2)
      },
      branches: branches.map(b => ({ name: normalizeBranchName(b.name), students: b.students, todayLessons: b.today_lessons })),
      recentStudents: recentStudents || [],
      todayLessons: todayLessonData || [],
      recentPayments: recentPayments || [],
      aiSummary: {
        ready: predictions.filter(p => p.testReadiness.classification === 'Ready').length,
        highRisk: predictions.filter(p => p.dropoutRisk.riskLevel === 'High Risk').length,
        medRisk: predictions.filter(p => p.dropoutRisk.riskLevel === 'Medium Risk').length,
        total: predictions.length
      }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Students list
router.get('/admin/students', auth, adminOnly, async (req, res) => {
  try {
    const students = await query(
      `SELECT p.*, b.name as branch_name 
       FROM profiles p
       LEFT JOIN branches b ON p.branch_id = b.id
       WHERE p.role = ?
       ORDER BY p.created_at DESC`,
      ['student']
    );
    
    const enrollments = await query(
      `SELECT e.student_id, e.status, e.lessons_completed, pkg.lesson_count 
       FROM enrollments e
       LEFT JOIN packages pkg ON e.package_id = pkg.id
       WHERE e.status = 'active'`
    );
    
    const enrMap = {};
    enrollments.forEach(e => {
      enrMap[e.student_id] = e;
    });
    
    const predictions = await getStudentPredictions(students.map(s => s.id));

    const enriched = students.map(s => {
      const e = enrMap[s.id];
      const ai = predictions[s.id];
      const pct = e ? Math.round(((e.lessons_completed || 0) / (e.lesson_count || 10)) * 100) : 0;
      return {
        ...safeProfile(s),
        branch_name: s.branch_name,
        enrollment_status: e?.status || null,
        lessons_completed: e?.lessons_completed || 0,
        total_lessons: e?.lesson_count || 0,
        completion_pct: pct,
        ai_risk: ai.dropoutRisk.riskLevel
      };
    });
    
    res.json({ success: true, user: req.session.user, students: enriched });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Student detail
router.get('/admin/students/:id', auth, adminOnly, async (req, res) => {
  try {
    const student = await queryOne(
      `SELECT p.*, b.name as branch_name 
       FROM profiles p
       LEFT JOIN branches b ON p.branch_id = b.id
       WHERE p.id = ?`,
      [req.params.id]
    );
    
    if (!student) return res.json({ success: false, error: 'Student not found.' });
    
    const ai = (await getStudentPredictions([student.id]))[student.id];
    res.json({ success: true, student: safeProfile(student), aiPredictions: ai });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Toggle student status
router.post('/admin/students/:id/toggle-status', auth, adminOnly, async (req, res) => {
  try {
    const student = await queryOne(
      'SELECT is_active FROM profiles WHERE id = ?',
      [req.params.id]
    );
    
    await query(
      'UPDATE profiles SET is_active = ? WHERE id = ?',
      [!student.is_active, req.params.id]
    );
    
    res.json({ success: true, is_active: !student.is_active });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Delete Student
router.delete('/admin/students/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    
    const student = await queryOne(
      'SELECT email FROM profiles WHERE id = ?',
      [id]
    );
    
    if (!student) {
      return res.json({ success: false, error: 'Student not found.' });
    }
    
    // Delete related records first (cascade will handle most)
    await query('DELETE FROM notifications WHERE user_id = ?', [id]);
    await query('DELETE FROM ai_predictions WHERE student_id = ?', [id]);
    await query('DELETE FROM payments WHERE student_id = ?', [id]);
    await query('DELETE FROM lessons WHERE student_id = ?', [id]);
    await query('DELETE FROM enrollments WHERE student_id = ?', [id]);
    await query('DELETE FROM profiles WHERE id = ?', [id]);
    
    res.json({ success: true, message: 'Student permanently deleted.' });
  } catch (err) {
    console.error('Delete student error:', err.message);
    serverError(req, res, err);
  }
});

// Enrollments
router.post('/admin/enrollments', auth, adminOnly, async (req, res) => {
  try {
    const { student_id, package_id, branch_id, instructor_id, start_date } = req.body;
    
    const pkg = await queryOne(
      'SELECT * FROM packages WHERE id = ?',
      [package_id]
    );
    
    if (!pkg) return res.json({ success: false, error: 'Package not found' });
    
    const [y, m, d] = String(start_date).split('-').map(Number);
    const end = localDate(new Date(y, m - 1, d + (pkg.validity_days || 0)));
    
    await query(
      `INSERT INTO enrollments (id, student_id, package_id, branch_id, instructor_id, 
        status, lessons_completed, lessons_remaining, start_date, end_date, balance_due, total_paid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), student_id, package_id, branch_id, instructor_id || null,
       'active', 0, pkg.lesson_count, start_date, end, pkg.price, 0]
    );
    
    await query(
      `INSERT INTO notifications (id, user_id, title, message, type) 
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), student_id, 'Enrollment Confirmed 🎉',
       `You have been enrolled in the ${pkg.name} package. Welcome aboard!`, 'success']
    );
    
    res.json({ success: true, message: 'Student enrolled successfully.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Get student enrollments
router.get('/admin/students/:id/enrollments', auth, adminOnly, async (req, res) => {
  try {
    const enrollments = await query(
      `SELECT e.id, e.student_id, e.balance_due, p.name as package_name 
       FROM enrollments e
       LEFT JOIN packages p ON e.package_id = p.id
       WHERE e.student_id = ? AND e.status = 'active'`,
      [req.params.id]
    );
    res.json({ success: true, enrollments: enrollments || [] });
  } catch (err) {
    res.json({ success: false, enrollments: [] });
  }
});

// ─── INSTRUCTORS ──────────────────────────────────────────────

// Instructors list
router.get('/admin/instructors', auth, adminOnly, async (req, res) => {
  try {
    const instructors = await query(
      `SELECT i.*, 
        CONCAT(p.first_name, ' ', p.last_name) as full_name,
        p.first_name, p.last_name, p.phone, p.is_active, p.must_change_password,
        b.name as branch_name
       FROM instructors i
       LEFT JOIN profiles p ON i.profile_id = p.id
       LEFT JOIN branches b ON i.branch_id = b.id
       ORDER BY i.created_at DESC`
    );
    
    const branches = await query(
      'SELECT * FROM branches WHERE is_active = true'
    );
    
    res.json({ success: true, user: req.session.user, instructors: instructors || [], branches: branches || [] });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Add instructor
router.post('/admin/instructors', auth, adminOnly, async (req, res) => {
  try {
    const { email, first_name, last_name, phone, branch_id, license_number, license_expiry, years_experience, bio } = req.body;
    
    if (!email || !first_name || !last_name || !phone || !branch_id) {
      return res.json({ success: false, error: 'Name, email, phone and branch are required.' });
    }
    
    const password = temporaryPassword();
    
    // Hash password
    const bcrypt = require('bcrypt');
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    
    const profileId = uuidv4();
    
    // Create profile
    await query(
      `INSERT INTO profiles (id, email, password_hash, role, first_name, last_name, phone, branch_id, must_change_password, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [profileId, email, password_hash, 'instructor', first_name, last_name, phone, branch_id, true, true]
    );
    
    // Create instructor record
    await query(
      `INSERT INTO instructors (id, profile_id, branch_id, license_number, license_expiry, years_experience, bio, is_available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), profileId, branch_id, license_number || null, license_expiry || null, parseInt(years_experience) || 0, bio || null, true]
    );
    
    res.json({ success: true, message: 'Instructor added successfully.', temporaryPassword: password });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Toggle instructor availability
router.post('/admin/instructors/:id/toggle', auth, adminOnly, async (req, res) => {
  try {
    const instructor = await queryOne(
      'SELECT is_available FROM instructors WHERE id = ?',
      [req.params.id]
    );
    
    await query(
      'UPDATE instructors SET is_available = ? WHERE id = ?',
      [!instructor.is_available, req.params.id]
    );
    
    res.json({ success: true, is_available: !instructor.is_available });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Delete Instructor
router.delete('/admin/instructors/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    
    const instructor = await queryOne(
      'SELECT profile_id FROM instructors WHERE id = ?',
      [id]
    );
    
    if (!instructor) {
      return res.json({ success: false, error: 'Instructor not found.' });
    }
    
    await query('DELETE FROM instructors WHERE id = ?', [id]);
    await query('DELETE FROM profiles WHERE id = ?', [instructor.profile_id]);
    
    res.json({ success: true, message: 'Instructor permanently deleted.' });
  } catch (err) {
    console.error('Delete instructor error:', err.message);
    serverError(req, res, err);
  }
});

// ─── VEHICLES ──────────────────────────────────────────────────

// GET all vehicles
router.get('/admin/vehicles', auth, adminOnly, async (req, res) => {
  try {
    const vehicles = await query(
      `SELECT v.*, b.name as branch_name 
       FROM vehicles v
       LEFT JOIN branches b ON v.branch_id = b.id
       ORDER BY v.created_at DESC`
    );
    
    const branches = await query(
      'SELECT * FROM branches WHERE is_active = true'
    );
    
    res.json({ success: true, user: req.session.user, vehicles: vehicles || [], branches: branches || [] });
  } catch (err) {
    serverError(req, res, err);
  }
});

// POST create vehicle
router.post('/admin/vehicles', auth, adminOnly, async (req, res) => {
  try {
    const { branch_id, make, model, year, registration_number, transmission, color, roadworthy_expiry, service_due_date } = req.body;
    
    await query(
      `INSERT INTO vehicles (id, branch_id, make, model, year, registration_number, 
        transmission, color, roadworthy_expiry, service_due_date, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), branch_id, make, model, parseInt(year) || null, registration_number,
       transmission, color || null, roadworthy_expiry || null, service_due_date || null, true]
    );
    
    res.json({ success: true, message: 'Vehicle added.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// PUT update vehicle
router.put('/admin/vehicles/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_id, make, model, year, registration_number, transmission, color, roadworthy_expiry, service_due_date, is_active } = req.body;
    
    await query(
      `UPDATE vehicles 
       SET branch_id = ?, make = ?, model = ?, year = ?, registration_number = ?,
           transmission = ?, color = ?, roadworthy_expiry = ?, service_due_date = ?, is_active = ?
       WHERE id = ?`,
      [branch_id, make, model, parseInt(year) || null, registration_number,
       transmission, color || null, roadworthy_expiry || null, service_due_date || null,
       is_active !== undefined ? is_active : true, id]
    );
    
    res.json({ success: true, message: 'Vehicle updated successfully.' });
  } catch (err) {
    console.error('Update vehicle error:', err.message);
    serverError(req, res, err);
  }
});

// DELETE vehicle
router.delete('/admin/vehicles/:id', auth, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if vehicle is used in lessons
    const lessons = await query(
      'SELECT id FROM lessons WHERE vehicle_id = ? LIMIT 1',
      [id]
    );
    
    if (lessons && lessons.length > 0) {
      return res.json({
        success: false,
        error: 'This vehicle is assigned to one or more lessons and cannot be deleted. Deactivate it instead.'
      });
    }
    
    await query('DELETE FROM vehicles WHERE id = ?', [id]);
    res.json({ success: true, message: 'Vehicle deleted successfully.' });
  } catch (err) {
    console.error('Delete vehicle error:', err.message);
    serverError(req, res, err);
  }
});

// Toggle vehicle active status
router.post('/admin/vehicles/:id/toggle', auth, adminOnly, async (req, res) => {
  try {
    const vehicle = await queryOne(
      'SELECT is_active FROM vehicles WHERE id = ?',
      [req.params.id]
    );
    
    await query(
      'UPDATE vehicles SET is_active = ? WHERE id = ?',
      [!vehicle.is_active, req.params.id]
    );
    
    res.json({ success: true, is_active: !vehicle.is_active });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── PACKAGES ──────────────────────────────────────────────────

// GET all packages
router.get('/admin/packages', auth, adminOnly, async (req, res) => {
  try {
    const packages = await query(
      'SELECT * FROM packages ORDER BY sort_order'
    );
    res.json({ success: true, user: req.session.user, packages: packages || [] });
  } catch (err) {
    serverError(req, res, err);
  }
});

// POST create package
router.post('/admin/packages', auth, adminOnly, async (req, res) => {
  try {
    const { name, description, lesson_count, price, validity_days, transmission_type, includes_yard_test, includes_road_test, is_popular } = req.body;
    
    await query(
      `INSERT INTO packages (id, name, description, lesson_count, price, validity_days, 
        transmission_type, includes_yard_test, includes_road_test, is_popular, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), name, description, parseInt(lesson_count), parseFloat(price),
       parseInt(validity_days) || 90, transmission_type || 'both',
       !!includes_yard_test, !!includes_road_test, !!is_popular, true]
    );
    
    res.json({ success: true, message: 'Package created.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// PUT update package
router.put('/admin/packages/:id', auth, adminOnly, async (req, res) => {
  try {
    const { name, description, lesson_count, price, validity_days, transmission_type, includes_yard_test, includes_road_test, is_popular, is_active } = req.body;
    
    await query(
      `UPDATE packages 
       SET name = ?, description = ?, lesson_count = ?, price = ?, validity_days = ?,
           transmission_type = ?, includes_yard_test = ?, includes_road_test = ?, 
           is_popular = ?, is_active = ?
       WHERE id = ?`,
      [name, description, parseInt(lesson_count), parseFloat(price), parseInt(validity_days),
       transmission_type, !!includes_yard_test, !!includes_road_test,
       !!is_popular, is_active !== false, req.params.id]
    );
    
    res.json({ success: true, message: 'Package updated.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// DELETE package
router.delete('/admin/packages/:id', auth, adminOnly, async (req, res) => {
  try {
    await query('DELETE FROM packages WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Package deleted successfully.' });
  } catch (err) {
    console.error('Delete package error:', err.message);
    serverError(req, res, err);
  }
});

// ─── SCHEDULE ──────────────────────────────────────────────────

// GET Schedule
router.get('/admin/schedule', auth, adminOnly, async (req, res) => {
  try {
    const { date, branch } = req.query;
    const targetDate = date || localDate();
    
    // Get all instructors for mapping
    const allInstructors = await query(
      'SELECT id, profile_id FROM instructors'
    );
    
    const instructorMap = {};
    allInstructors.forEach(inst => {
      instructorMap[inst.profile_id] = inst.id;
    });
    
    let sql = `
      SELECT 
        l.id, l.scheduled_time, l.scheduled_date, l.status, l.lesson_type, 
        l.duration_minutes, l.qr_code_token, l.instructor_id,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.phone as student_phone,
        CONCAT(i.first_name, ' ', i.last_name) as instructor_name,
        CONCAT(v.make, ' ', v.model, ' (', v.registration_number, ')') as vehicle,
        b.name as branch_name
      FROM lessons l
      LEFT JOIN profiles s ON l.student_id = s.id
      LEFT JOIN profiles i ON l.instructor_id = i.id
      LEFT JOIN vehicles v ON l.vehicle_id = v.id
      LEFT JOIN branches b ON l.branch_id = b.id
      WHERE l.scheduled_date = ?
      ORDER BY l.scheduled_time ASC
    `;
    
    let lessons = await query(sql, [targetDate]);
    
    // Filter by branch if specified
    if (branch) {
      lessons = lessons.filter(l => 
        l.branch_name && l.branch_name.toLowerCase().includes(branch.toLowerCase())
      );
    }
    
    // Get students, instructors, vehicles, branches for dropdowns
    const students = await query(
      "SELECT id, CONCAT(first_name, ' ', last_name) as name FROM profiles WHERE role = 'student' AND is_active = true"
    );
    
    const instructors = await query(
      `SELECT i.id as instructorRecordId, i.profile_id, CONCAT(p.first_name, ' ', p.last_name) as name
       FROM instructors i
       LEFT JOIN profiles p ON i.profile_id = p.id
       WHERE i.is_available = true`
    );
    
    const vehicles = await query(
      "SELECT id, make, model, registration_number, branch_id FROM vehicles WHERE is_active = true"
    );
    
    const branches = await query(
      "SELECT * FROM branches WHERE is_active = true"
    );
    
    const formattedLessons = lessons.map(l => ({
      ...l,
      instructor_record_id: instructorMap[l.instructor_id] || null
    }));
    
    res.json({
      success: true,
      user: req.session.user,
      lessons: formattedLessons,
      students: students || [],
      instructors: instructors || [],
      vehicles: vehicles || [],
      branches: branches || []
    });
  } catch (err) {
    console.error('Schedule GET error:', err.message);
    serverError(req, res, err);
  }
});

// POST Schedule
router.post('/admin/schedule', auth, adminOnly, async (req, res) => {
  try {
    const { student_id, instructor_id, vehicle_id, branch_id, lesson_type, scheduled_date, scheduled_time, duration_minutes, location, enrollment_id } = req.body;
    const qrToken = uuidv4();
    const qrUrl = `${process.env.APP_URL || 'http://localhost:3000'}/student/scan-qr.html?token=${qrToken}`;
    
    let finalInstructorId = instructor_id || null;
    
    // Check if instructor_id is a profile_id or instructor record id
    if (instructor_id) {
      const checkProfile = await queryOne(
        'SELECT profile_id FROM instructors WHERE profile_id = ?',
        [instructor_id]
      );
      
      if (!checkProfile) {
        const instructorRecord = await queryOne(
          'SELECT profile_id FROM instructors WHERE id = ?',
          [instructor_id]
        );
        if (instructorRecord) {
          finalInstructorId = instructorRecord.profile_id;
        }
      }
    }
    
    const lessonId = uuidv4();
    
    await query(
      `INSERT INTO lessons (id, student_id, instructor_id, vehicle_id, branch_id, 
        lesson_type, scheduled_date, scheduled_time, duration_minutes, 
        location, enrollment_id, qr_code_token, qr_code_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lessonId, student_id, finalInstructorId, vehicle_id || null, branch_id,
       lesson_type || 'practical', scheduled_date, scheduled_time, parseInt(duration_minutes) || 60,
       location || null, enrollment_id || null, qrToken, qrUrl, 'scheduled']
    );
    
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2, color: { dark: '#0f2a4a', light: '#ffffff' } });
    
    await query(
      `INSERT INTO notifications (id, user_id, title, message, type, action_url) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), student_id, 'New Lesson Scheduled 📅',
       `A ${lesson_type || 'practical'} lesson has been scheduled for ${scheduled_date} at ${scheduled_time}.`,
       'lesson', '/student/lessons.html']
    );
    
    res.json({
      success: true,
      message: 'Lesson scheduled.',
      lesson: { id: lessonId },
      qrCode: qrDataUrl
    });
  } catch (err) {
    console.error('Schedule POST error:', err.message);
    serverError(req, res, err);
  }
});

// Update lesson status
router.post('/admin/schedule/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { status, instructor_notes, student_score, skill_scores } = req.body;
    const updates = [];
    const params = [];

    updates.push('status = ?');
    params.push(status);

    if (instructor_notes) {
      updates.push('instructor_notes = ?');
      params.push(instructor_notes);
    }
    if (student_score !== undefined && student_score !== '') {
      updates.push('student_score = ?');
      params.push(parseInt(student_score));
    }
    // Only overwrite earlier ratings when at least one skill was rated this time
    const skills = parseSkillScores(skill_scores);
    if (skills) {
      updates.push('areas_covered = ?');
      params.push(JSON.stringify(skills));
    }
    if (status === 'completed') {
      updates.push('attendance_marked_at = NOW()');
    }
    
    params.push(req.params.id);
    
    await query(
      `UPDATE lessons SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    res.json({ success: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Admin QR Route
router.get('/admin/schedule/:id/qr', auth, adminOnly, async (req, res) => {
  try {
    let lesson = await queryOne(
      'SELECT * FROM lessons WHERE id = ?',
      [req.params.id]
    );
    
    if (!lesson) return res.json({ success: false, error: 'Lesson not found' });
    
    let qrToken = lesson.qr_code_token;
    if (!qrToken) {
      qrToken = uuidv4();
      const qrUrl = `${process.env.APP_URL || 'http://localhost:3000'}/student/scan-qr.html?token=${qrToken}`;
      await query(
        'UPDATE lessons SET qr_code_token = ?, qr_code_url = ? WHERE id = ?',
        [qrToken, qrUrl, req.params.id]
      );
      
      lesson = await queryOne(
        'SELECT * FROM lessons WHERE id = ?',
        [req.params.id]
      );
    }
    
    const qrUrl = lesson.qr_code_url || `${process.env.APP_URL || 'http://localhost:3000'}/student/scan-qr.html?token=${qrToken}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2, color: { dark: '#0f2a4a', light: '#ffffff' } });
    
    res.json({ success: true, qrCode: qrDataUrl, date: lesson.scheduled_date, time: lesson.scheduled_time });
  } catch (err) {
    console.error('Admin QR error:', err.message);
    serverError(req, res, err);
  }
});

// ─── ATTENDANCE ───────────────────────────────────────────────

// Admin attendance
router.get('/admin/attendance', auth, adminOnly, async (req, res) => {
  try {
    const { date, branch } = req.query;
    const targetDate = date || localDate();
    
    const lessons = await query(
      `SELECT 
        l.id, l.scheduled_time, l.scheduled_date, l.status, l.lesson_type,
        l.attendance_marked_at, l.attendance_method,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.phone as student_phone,
        CONCAT(i.first_name, ' ', i.last_name) as instructor_name,
        b.name as branch_name
       FROM lessons l
       LEFT JOIN profiles s ON l.student_id = s.id
       LEFT JOIN profiles i ON l.instructor_id = i.id
       LEFT JOIN branches b ON l.branch_id = b.id
       WHERE l.scheduled_date = ?
       ORDER BY l.scheduled_time ASC`,
      [targetDate]
    );
    
    res.json({
      success: true,
      user: req.session.user,
      lessons: lessons || []
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Instructor attendance
router.get('/instructor/attendance', auth, instructorOnly, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { date } = req.query;
    const targetDate = date || localDate();
    
    const instructor = await getInstructorRecord(userId);
    const ids = [userId, instructor?.id].filter(Boolean);
    
    const lessons = await query(
      `SELECT 
        l.id, l.scheduled_time, l.scheduled_date, l.status, l.lesson_type,
        l.attendance_marked_at, l.attendance_method,
        CONCAT(s.first_name, ' ', s.last_name) as student_name,
        s.phone as student_phone,
        b.name as branch_name
       FROM lessons l
       LEFT JOIN profiles s ON l.student_id = s.id
       LEFT JOIN branches b ON l.branch_id = b.id
       WHERE l.instructor_id IN (?) AND l.scheduled_date = ?
       ORDER BY l.scheduled_time ASC`,
      [ids, targetDate]
    );
    
    res.json({
      success: true,
      user: req.session.user,
      lessons: lessons || []
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Mark attendance
router.post('/admin/attendance/:id/mark', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    await query(
      'UPDATE lessons SET status = ?, attendance_marked_at = NOW(), attendance_method = ? WHERE id = ?',
      [status, 'manual', req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Instructor mark attendance
router.post('/instructor/attendance/:id/mark', auth, instructorOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.session.user.id;
    const instructor = await getInstructorRecord(userId);
    const ids = [userId, instructor?.id].filter(Boolean);
    
    await query(
      'UPDATE lessons SET status = ?, attendance_marked_at = NOW(), attendance_method = ? WHERE id = ? AND instructor_id IN (?)',
      [status, 'manual', req.params.id, ids]
    );
    res.json({ success: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── INSTRUCTOR APIS ──────────────────────────────────────────

router.get('/instructor/dashboard', auth, instructorOnly, async (req, res) => {
  try {
    const today = localDate();
    const { instructor, lessons } = await getInstructorLessons(req.session.user.id, { fromDate: today });
    
    const todayLessons = lessons.filter(l => l.scheduled_date === today);
    const upcomingLessons = lessons.filter(l => l.scheduled_date >= today && ['scheduled', 'in_progress'].includes(l.status)).slice(0, 12);
    
    res.json({
      success: true,
      user: req.session.user,
      instructor,
      todayLessons,
      upcomingLessons,
      stats: {
        today: todayLessons.length,
        upcoming: upcomingLessons.length,
        completed: lessons.filter(l => l.status === 'completed').length,
        pendingScores: lessons.filter(l => l.status === 'completed' && l.student_score == null).length
      }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.get('/instructor/lessons', auth, instructorOnly, async (req, res) => {
  try {
    const { lessons } = await getInstructorLessons(req.session.user.id, {
      fromDate: req.query.from || undefined,
      date: req.query.date || undefined
    });
    res.json({ success: true, user: req.session.user, lessons });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.post('/instructor/lessons/:id/status', auth, instructorOnly, async (req, res) => {
  try {
    const instructor = await getInstructorRecord(req.session.user.id);
    const ids = [req.session.user.id, instructor?.id].filter(Boolean);
    const { status, instructor_notes, student_score, skill_scores } = req.body;

    const allowed = ['scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'];
    if (!allowed.includes(status)) return res.json({ success: false, error: 'Invalid lesson status.' });
    
    const updates = [];
    const params = [];
    
    updates.push('status = ?');
    params.push(status);
    
    if (instructor_notes !== undefined) {
      updates.push('instructor_notes = ?');
      params.push(instructor_notes || null);
    }
    if (student_score !== undefined && student_score !== '') {
      updates.push('student_score = ?');
      params.push(parseInt(student_score));
    }
    if (skill_scores !== undefined) {
      const skills = parseSkillScores(skill_scores);
      updates.push('areas_covered = ?');
      params.push(skills ? JSON.stringify(skills) : null);
    }
    if (['completed', 'no_show', 'in_progress'].includes(status)) {
      updates.push('attendance_marked_at = NOW()');
      updates.push('attendance_method = ?');
      params.push('manual');
    }
    
    params.push(req.params.id);
    params.push(ids);
    
    await query(
      `UPDATE lessons SET ${updates.join(', ')} WHERE id = ? AND instructor_id IN (?)`,
      params
    );
    
    res.json({ success: true, message: 'Lesson updated.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Instructor QR Route
router.get('/instructor/lessons/:id/qr', auth, instructorOnly, async (req, res) => {
  try {
    const instructor = await getInstructorRecord(req.session.user.id);
    const ids = [req.session.user.id, instructor?.id].filter(Boolean);
    
    let lesson = await queryOne(
      'SELECT * FROM lessons WHERE id = ? AND instructor_id IN (?)',
      [req.params.id, ids]
    );
    
    if (!lesson) return res.json({ success: false, error: 'Lesson not found.' });
    
    let qrToken = lesson.qr_code_token;
    if (!qrToken) {
      qrToken = uuidv4();
      const qrUrl = `${process.env.APP_URL || 'http://localhost:3000'}/student/scan-qr.html?token=${qrToken}`;
      await query(
        'UPDATE lessons SET qr_code_token = ?, qr_code_url = ? WHERE id = ?',
        [qrToken, qrUrl, req.params.id]
      );
      
      lesson = await queryOne(
        'SELECT * FROM lessons WHERE id = ?',
        [req.params.id]
      );
    }
    
    const qrUrl = lesson.qr_code_url || `${process.env.APP_URL || 'http://localhost:3000'}/student/scan-qr.html?token=${qrToken}`;
    const qrCode = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2, color: { dark: '#0f2a4a', light: '#ffffff' } });
    
    res.json({ success: true, qrCode, date: lesson.scheduled_date, time: lesson.scheduled_time });
  } catch (err) {
    console.error('Instructor QR error:', err.message);
    serverError(req, res, err);
  }
});

// Instructor Cancel Lesson
router.post('/instructor/lessons/:id/cancel', auth, instructorOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const instructor = await getInstructorRecord(req.session.user.id);
    const ids = [req.session.user.id, instructor?.id].filter(Boolean);
    
    const lesson = await queryOne(
      'SELECT * FROM lessons WHERE id = ? AND instructor_id IN (?)',
      [id, ids]
    );
    
    if (!lesson) {
      return res.json({ success: false, error: 'Lesson not found or not assigned to you.' });
    }
    
    if (lesson.status !== 'scheduled') {
      return res.json({ success: false, error: 'Only scheduled lessons can be cancelled.' });
    }
    
    await query(
      'UPDATE lessons SET status = ? WHERE id = ?',
      ['cancelled', id]
    );
    
    await query(
      `INSERT INTO notifications (id, user_id, title, message, type, action_url) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), lesson.student_id, '❌ Lesson Cancelled',
       `Your ${lesson.lesson_type || 'practical'} lesson scheduled for ${lesson.scheduled_date} at ${lesson.scheduled_time} has been cancelled.`,
       'warning', '/student/lessons.html']
    );
    
    res.json({ success: true, message: 'Lesson cancelled successfully.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.get('/instructor/profile', auth, instructorOnly, async (req, res) => {
  try {
    const profile = await queryOne(
      `SELECT p.*, b.name as branch_name 
       FROM profiles p
       LEFT JOIN branches b ON p.branch_id = b.id
       WHERE p.id = ?`,
      [req.session.user.id]
    );
    
    const instructor = await getInstructorRecord(req.session.user.id);
    
    res.json({
      success: true,
      profile: { ...profile, email: req.session.user.email },
      instructor
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.put('/instructor/profile', auth, instructorOnly, async (req, res) => {
  try {
    const { first_name, last_name, phone, address, city, license_number, license_expiry, years_experience, bio, is_available } = req.body;
    
    await query(
      `UPDATE profiles 
       SET first_name = ?, last_name = ?, phone = ?, address = ?, city = ?
       WHERE id = ?`,
      [first_name, last_name, phone, address, city, req.session.user.id]
    );
    
    await query(
      `UPDATE instructors 
       SET license_number = ?, license_expiry = ?, years_experience = ?, bio = ?, is_available = ?
       WHERE profile_id = ?`,
      [license_number || null, license_expiry || null, parseInt(years_experience) || 0, bio || null, !!is_available, req.session.user.id]
    );
    
    if (first_name) {
      req.session.user.firstName = first_name;
      req.session.user.lastName = last_name || req.session.user.lastName;
      req.session.user.fullName = `${first_name} ${last_name || req.session.user.lastName}`.trim();
    }
    
    res.json({ success: true, message: 'Profile updated.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.post('/instructor/availability', auth, instructorOnly, async (req, res) => {
  try {
    const { is_available } = req.body;
    await query(
      'UPDATE instructors SET is_available = ? WHERE profile_id = ?',
      [!!is_available, req.session.user.id]
    );
    res.json({ success: true, is_available: !!is_available });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── AI INSIGHTS ──────────────────────────────────────────────

// Admin AI Insights
router.get('/admin/ai-insights', auth, adminOnly, async (req, res) => {
  try {
    const students = await query(
      'SELECT id, first_name, last_name, created_at FROM profiles WHERE role = ? AND is_active = true ORDER BY first_name, last_name',
      ['student']
    );
    
    const aiById = await getStudentPredictions(students.map(s => s.id));
    const predictions = students.map(s => ({ ...s, ...aiById[s.id] }));
    const ready = predictions.filter(p => p.testReadiness?.classification === 'Ready').length;
    const nearly = predictions.filter(p => p.testReadiness?.classification === 'Nearly Ready').length;
    const highRisk = predictions.filter(p => p.dropoutRisk?.riskLevel === 'High Risk').length;
    const medRisk = predictions.filter(p => p.dropoutRisk?.riskLevel === 'Medium Risk').length;
    
    res.json({
      success: true,
      user: req.session.user,
      predictions,
      summary: { ready, nearly, highRisk, medRisk, total: predictions.length }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// Instructor AI Insights
router.get('/instructor/ai-insights', auth, instructorOnly, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const instructor = await getInstructorRecord(userId);
    const ids = [userId, instructor?.id].filter(Boolean);
    
    const lessons = await query(
      'SELECT DISTINCT student_id FROM lessons WHERE instructor_id IN (?) AND student_id IS NOT NULL',
      [ids]
    );
    
    const studentIds = lessons.map(l => l.student_id);
    
    if (studentIds.length === 0) {
      return res.json({
        success: true,
        user: req.session.user,
        predictions: [],
        summary: { ready: 0, nearly: 0, highRisk: 0, medRisk: 0, total: 0 }
      });
    }
    
    const students = await query(
      'SELECT id, first_name, last_name, created_at FROM profiles WHERE id IN (?) AND role = ? AND is_active = true',
      [studentIds, 'student']
    );
    
    const aiById = await getStudentPredictions(students.map(s => s.id));
    const predictions = students.map(s => ({ ...s, ...aiById[s.id] }));
    const ready = predictions.filter(p => p.testReadiness?.classification === 'Ready').length;
    const nearly = predictions.filter(p => p.testReadiness?.classification === 'Nearly Ready').length;
    const highRisk = predictions.filter(p => p.dropoutRisk?.riskLevel === 'High Risk').length;
    const medRisk = predictions.filter(p => p.dropoutRisk?.riskLevel === 'Medium Risk').length;
    
    res.json({
      success: true,
      user: req.session.user,
      predictions,
      summary: { ready, nearly, highRisk, medRisk, total: predictions.length }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── PAYMENTS ──────────────────────────────────────────────────

router.get('/admin/payments', auth, adminOnly, async (req, res) => {
  try {
    const monthStart = startOfMonth();
    
    const payments = await query(
      `SELECT p.*, CONCAT(prof.first_name, ' ', prof.last_name) as student_name, prof.phone as student_phone
       FROM payments p
       LEFT JOIN profiles prof ON p.student_id = prof.id
       ORDER BY p.payment_date DESC`
    );
    
    const students = await query(
      'SELECT id, first_name, last_name FROM profiles WHERE role = ? AND is_active = true',
      ['student']
    );
    
    const branches = await query(
      'SELECT * FROM branches WHERE is_active = true'
    );
    
    const monthPay = await query(
      'SELECT amount FROM payments WHERE status = ? AND payment_date >= ?',
      ['completed', monthStart]
    );
    
    const allEnrollments = await query(
      'SELECT balance_due FROM enrollments WHERE status = ?',
      ['active']
    );
    
    const monthRevenue = monthPay.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const totalRevenue = payments.filter(p => p.status === 'completed').reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    const totalOutstanding = allEnrollments.reduce((s, e) => s + parseFloat(e.balance_due || 0), 0);
    
    res.json({
      success: true,
      user: req.session.user,
      payments: payments || [],
      students: students || [],
      branches: branches || [],
      monthRevenue: monthRevenue.toFixed(2),
      totalRevenue: totalRevenue.toFixed(2),
      totalOutstanding: totalOutstanding.toFixed(2)
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.post('/admin/payments', auth, adminOnly, async (req, res) => {
  try {
    const { student_id, enrollment_id, amount, payment_method, reference_number, description, branch_id } = req.body;
    
    const paymentId = uuidv4();
    
    await query(
      `INSERT INTO payments (id, student_id, enrollment_id, amount, payment_method, 
        reference_number, description, branch_id, status, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [paymentId, student_id, enrollment_id || null, parseFloat(amount), payment_method,
       reference_number || null, description || null, branch_id || null, 'completed', req.session.user.id]
    );
    
    if (enrollment_id) {
      const enr = await queryOne(
        'SELECT total_paid, balance_due FROM enrollments WHERE id = ?',
        [enrollment_id]
      );
      
      if (enr) {
        await query(
          'UPDATE enrollments SET total_paid = ?, balance_due = ? WHERE id = ?',
          [(parseFloat(enr.total_paid) || 0) + parseFloat(amount), Math.max((parseFloat(enr.balance_due) || 0) - parseFloat(amount), 0), enrollment_id]
        );
      }
    }
    
    await query(
      `INSERT INTO notifications (id, user_id, title, message, type, action_url) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), student_id, 'Payment Received 💰',
       `Your payment of R${parseFloat(amount).toFixed(2)} has been received. Thank you!`,
       'payment', '/student/payments.html']
    );
    
    res.json({ success: true, message: 'Payment recorded.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── REPORTS ──────────────────────────────────────────────────

router.get('/admin/reports', auth, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    // The current month and the 5 before it, oldest first
    const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
    const keys = months.map(monthKey);
    const thisMonth = keys[5];
    const since = `${keys[0]}-01`;

    const [students, payments, lessons, enrollments, branches] = await Promise.all([
      query("SELECT id, branch_id FROM profiles WHERE role = 'student' AND is_active = TRUE"),
      query("SELECT amount, branch_id, DATE_FORMAT(payment_date, '%Y-%m') AS ym FROM payments WHERE status = 'completed' AND payment_date >= ?", [since]),
      query("SELECT status, lesson_type, branch_id, DATE_FORMAT(scheduled_date, '%Y-%m') AS ym FROM lessons WHERE scheduled_date >= ?", [since]),
      query("SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym FROM enrollments WHERE created_at >= ?", [since]),
      query('SELECT id, name FROM branches ORDER BY name')
    ]);

    const sum = rows => rows.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
    // Attended ÷ (attended + no-shows); null when no lessons have been marked yet
    const attendance = rows => {
      const attended = rows.filter(l => ['completed', 'in_progress'].includes(l.status)).length;
      const missed = rows.filter(l => l.status === 'no_show').length;
      return attended + missed ? Math.round((attended / (attended + missed)) * 100) : null;
    };

    const monthLessons = lessons.filter(l => l.ym === thisMonth);
    const monthPayments = payments.filter(p => p.ym === thisMonth);
    const lessonTypes = ['practical', 'theory', 'yard_test', 'road_test']
      .map(type => monthLessons.filter(l => l.lesson_type === type).length);

    const predictions = await getStudentPredictions(students.map(s => s.id));
    const readyForTest = Object.values(predictions).filter(p => p.testReadiness.classification === 'Ready').length;

    res.json({
      success: true,
      user: req.session.user,
      reports: {
        totalStudents: students.length,
        monthRevenue: sum(monthPayments).toFixed(2),
        readyForTest,
        monthLessons: monthLessons.length,
        months: months.map(d => d.toLocaleString('en-ZA', { month: 'short', year: '2-digit' })),
        revenue: keys.map(k => Math.round(sum(payments.filter(p => p.ym === k)))),
        enrollments: keys.map(k => enrollments.filter(e => e.ym === k).length),
        attendanceRates: keys.map(k => attendance(lessons.filter(l => l.ym === k))),
        lessonTypes,
        branches: branches.map(b => ({
          name: normalizeBranchName(b.name),
          activeStudents: students.filter(s => s.branch_id === b.id).length,
          revenue: Math.round(sum(monthPayments.filter(p => p.branch_id === b.id))),
          lessons: monthLessons.filter(l => l.branch_id === b.id).length,
          attendance: attendance(monthLessons.filter(l => l.branch_id === b.id))
        }))
      }
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── INQUIRIES ─────────────────────────────────────────────────

router.get('/admin/inquiries', auth, adminOnly, async (req, res) => {
  try {
    const inquiries = await query(
      `SELECT c.*, b.name as branch_name 
       FROM contact_submissions c
       LEFT JOIN branches b ON c.branch_id = b.id
       ORDER BY c.created_at DESC`
    );
    res.json({ success: true, user: req.session.user, inquiries: inquiries || [] });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.post('/admin/inquiries/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const allowedStatuses = ['new', 'read', 'responded', 'closed'];
    if (!allowedStatuses.includes(req.body.status)) {
      return res.json({ success: false, error: 'Invalid inquiry status.' });
    }
    await query(
      'UPDATE contact_submissions SET status = ? WHERE id = ?',
      [req.body.status, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    serverError(req, res, err);
  }
});

router.delete('/admin/inquiries/:id', auth, adminOnly, async (req, res) => {
  try {
    await query('DELETE FROM contact_submissions WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Inquiry deleted.' });
  } catch (err) {
    serverError(req, res, err);
  }
});

// ─── BRANCHES ──────────────────────────────────────────────────

router.get('/admin/branches', async (req, res) => {
  try {
    const branches = await query(
      'SELECT * FROM branches WHERE is_active = true'
    );
    res.json({
      success: true,
      branches: branches.map(b => ({
        ...b,
        name: normalizeBranchName(b.name)
      }))
    });
  } catch (err) {
    console.error('Branches error:', err.message);
    res.json({ success: false, branches: [] });
  }
});

// ─── STUDENT SELF-BOOKING ────────────────────────────────────

// POST /student/schedule
router.post('/student/schedule', auth, async (req, res) => {
  try {
    const { instructor_id, vehicle_id, branch_id, lesson_type, scheduled_date, scheduled_time, duration_minutes } = req.body;
    const student_id = req.session.user.id;
    const duration = parseInt(duration_minutes) || 60;
    
    console.log('📝 Student booking request:', { student_id, instructor_id, scheduled_date, scheduled_time });
    
    if (!instructor_id || !branch_id || !scheduled_date || !scheduled_time) {
      return res.json({ success: false, error: 'Instructor, branch, date and time are required.' });
    }
    
    const today = localDate();
    if (scheduled_date < today) {
      return res.json({ success: false, error: 'You cannot book a lesson in the past.' });
    }
    
    if (isPublicHoliday(scheduled_date)) {
      return res.json({ success: false, error: 'Branch is closed on public holidays.' });
    }
    
    const branchStatus = isBranchOpen(scheduled_date, scheduled_time);
    if (!branchStatus.open) {
      return res.json({ success: false, error: branchStatus.reason });
    }
    
    const [hour, minute] = scheduled_time.split(':').map(Number);
    const endMinutes = hour * 60 + minute + duration;
    const endHour = Math.floor(endMinutes / 60);
    const endMinute = endMinutes % 60;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
    
    // Check student conflicts
    const studentConflicts = await query(
      `SELECT * FROM lessons 
       WHERE student_id = ? 
         AND scheduled_date = ? 
         AND status IN ('scheduled', 'in_progress')`,
      [student_id, scheduled_date]
    );
    
    for (const conflict of studentConflicts) {
      const [cHour, cMinute] = conflict.scheduled_time.split(':').map(Number);
      const cStart = cHour * 60 + cMinute;
      const cEnd = cStart + (conflict.duration_minutes || 60);
      const lStart = hour * 60 + minute;
      const lEnd = lStart + duration;
      
      if (lStart < cEnd && lEnd > cStart) {
        return res.json({
          success: false,
          error: `You already have a lesson at ${conflict.scheduled_time} on this day.`
        });
      }
    }
    
    // Check instructor conflicts
    const instructorConflicts = await query(
      `SELECT * FROM lessons 
       WHERE instructor_id = ? 
         AND scheduled_date = ? 
         AND status IN ('scheduled', 'in_progress')`,
      [instructor_id, scheduled_date]
    );
    
    for (const conflict of instructorConflicts) {
      const [cHour, cMinute] = conflict.scheduled_time.split(':').map(Number);
      const cStart = cHour * 60 + cMinute;
      const cEnd = cStart + (conflict.duration_minutes || 60);
      const lStart = hour * 60 + minute;
      const lEnd = lStart + duration;
      
      if (lStart < cEnd && lEnd > cStart) {
        return res.json({
          success: false,
          error: `Instructor is already booked at ${conflict.scheduled_time} on this day.`
        });
      }
    }
    
    // Check vehicle conflicts
    if (vehicle_id) {
      const vehicleConflicts = await query(
        `SELECT * FROM lessons 
         WHERE vehicle_id = ? 
           AND scheduled_date = ? 
           AND status IN ('scheduled', 'in_progress')`,
        [vehicle_id, scheduled_date]
      );
      
      for (const conflict of vehicleConflicts) {
        const [cHour, cMinute] = conflict.scheduled_time.split(':').map(Number);
        const cStart = cHour * 60 + cMinute;
        const cEnd = cStart + (conflict.duration_minutes || 60);
        const lStart = hour * 60 + minute;
        const lEnd = lStart + duration;
        
        if (lStart < cEnd && lEnd > cStart) {
          return res.json({
            success: false,
            error: `Vehicle is already booked at ${conflict.scheduled_time} on this day.`
          });
        }
      }
    }
    
    // Create the lesson WITHOUT QR code
    const lessonId = uuidv4();
    
    await query(
      `INSERT INTO lessons (id, student_id, instructor_id, vehicle_id, branch_id, 
        lesson_type, scheduled_date, scheduled_time, duration_minutes, status,
        qr_code_token, qr_code_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lessonId, student_id, instructor_id, vehicle_id || null, branch_id,
       lesson_type || 'practical', scheduled_date, scheduled_time, duration,
       'scheduled', null, null]
    );
    
    // Notify instructor
    await query(
      `INSERT INTO notifications (id, user_id, title, message, type, action_url) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), instructor_id, '📅 New Lesson Booked',
       `${req.session.user.firstName} has booked a ${lesson_type || 'practical'} lesson on ${scheduled_date} at ${scheduled_time}.`,
       'info', '/instructor/schedule.html']
    );
    
    // Notify student
    await query(
      `INSERT INTO notifications (id, user_id, title, message, type, action_url) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuidv4(), student_id, '✅ Lesson Booked Successfully',
       `Your ${lesson_type || 'practical'} lesson has been booked for ${scheduled_date} at ${scheduled_time}. Please arrive at the branch on time.`,
       'success', '/student/lessons.html']
    );
    
    console.log('✅ Student booking successful:', lessonId);
    
    res.json({
      success: true,
      message: `Lesson booked for ${scheduled_date} at ${scheduled_time}! Your instructor will confirm the lesson.`,
      lesson: {
        id: lessonId,
        qr_code_token: null,
        qr_code_url: null,
        qr_note: 'QR code will be provided by your instructor at the branch.'
      }
    });
  } catch (err) {
    console.error('❌ Student booking error:', err.message);
    res.json({ success: false, error: 'Failed to book lesson. Please try again.' });
  }
});

// GET /student/available-instructors
router.get('/student/available-instructors', auth, async (req, res) => {
  try {
    const { date, time, branch_id } = req.query;
    
    if (!date || !branch_id) {
      return res.json({ success: false, error: 'Date and branch are required.' });
    }
    
    let instructors = await query(
      `SELECT i.id as instructorRecordId, i.profile_id, i.branch_id, i.years_experience,
        CONCAT(p.first_name, ' ', p.last_name) as name, p.phone
       FROM instructors i
       LEFT JOIN profiles p ON i.profile_id = p.id
       WHERE i.branch_id = ? AND i.is_available = true`,
      [branch_id]
    );
    
    if (time) {
      const [hour, minute] = time.split(':').map(Number);
      const duration = 60;
      const lessonStart = hour * 60 + minute;
      const lessonEnd = lessonStart + duration;
      
      const bookedLessons = await query(
        `SELECT instructor_id, scheduled_time, duration_minutes 
         FROM lessons 
         WHERE scheduled_date = ? 
           AND status IN ('scheduled', 'in_progress')`,
        [date]
      );
      
      const bookedInstructors = new Set();
      for (const lesson of bookedLessons) {
        const [lHour, lMinute] = lesson.scheduled_time.split(':').map(Number);
        const lStart = lHour * 60 + lMinute;
        const lEnd = lStart + (lesson.duration_minutes || 60);
        
        if (lessonStart < lEnd && lessonEnd > lStart) {
          bookedInstructors.add(lesson.instructor_id);
        }
      }
      
      instructors = instructors.filter(i => !bookedInstructors.has(i.profile_id));
    }
    
    res.json({
      success: true,
      instructors: instructors.map(i => ({
        id: i.profile_id,
        instructorRecordId: i.instructorRecordId,
        name: i.name || 'Instructor',
        phone: i.phone,
        branch_id: i.branch_id,
        years_experience: i.years_experience
      }))
    });
  } catch (err) {
    serverError(req, res, err);
  }
});

// GET /api/vehicles/public
router.get('/vehicles/public', async (req, res) => {
  try {
    const { branch_id } = req.query;
    let sql = 'SELECT * FROM vehicles WHERE is_active = true';
    const params = [];
    
    if (branch_id) {
      sql += ' AND branch_id = ?';
      params.push(branch_id);
    }
    
    const vehicles = await query(sql, params);
    res.json({ success: true, vehicles: vehicles || [] });
  } catch (err) {
    console.error('Public vehicles error:', err.message);
    res.json({ success: false, vehicles: [] });
  }
});

module.exports = router;