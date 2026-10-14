const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const crypto = require('crypto');
const { sendPasswordResetEmail, sendPasswordChangedEmail, sendVerificationEmail } = require('../utils/mailer');

// ─── HELPERS: Emailed one-time links ─────────────────────────
// Only a SHA-256 hash of each token is stored, so a leaked database
// can't be used to verify accounts or reset passwords.
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function appUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

async function sendVerificationLink(req, user) {
  const token = crypto.randomBytes(32).toString('hex');
  // Each email gets its own token, so every link sent stays valid (emails can
  // arrive late or out of order, and people often sign up or resend twice)
  await pool.query(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))',
    [user.id, hashToken(token)]
  );
  const verifyUrl = `${appUrl(req)}/auth/verify-email?token=${token}`;
  sendVerificationEmail({ to: user.email, firstName: user.first_name, verifyUrl })
    .catch(err => console.error('Verification email failed:', err.message));
}

// ─── HELPER: Get user by email ──────────────────────────────
async function getUserByEmail(email) {
  const [rows] = await pool.query(
    'SELECT * FROM profiles WHERE email = ?',
    [email]
  );
  return rows.length > 0 ? rows[0] : null;
}

// ─── HELPER: Get user by ID ──────────────────────────────────
async function getUserById(id) {
  const [rows] = await pool.query(
    `SELECT 
      p.*,
      b.name as branch_name
    FROM profiles p
    LEFT JOIN branches b ON p.branch_id = b.id
    WHERE p.id = ?`,
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

// ─── POST /auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('🔐 Login attempt for:', email);
    
    if (!email || !password) {
      return res.redirect('/auth/login.html?error=Email and password are required');
    }

    // Find user by email
    const user = await getUserByEmail(email);
    
    if (!user) {
      console.log('❌ User not found:', email);
      return res.redirect('/auth/login.html?error=Invalid email or password');
    }

    // Check if user is active
    if (!user.is_active) {
      return res.redirect('/auth/login.html?error=Your account has been deactivated.');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      console.log('❌ Invalid password for:', email);
      return res.redirect('/auth/login.html?error=Invalid email or password');
    }

    if (!user.email_verified) {
      const msg = 'Please verify your email first. Check your inbox (and spam folder) for the verification link. It can take a few minutes to arrive.';
      return res.redirect(`/auth/login.html?unverified=1&email=${encodeURIComponent(user.email)}&error=${encodeURIComponent(msg)}`);
    }

    // Get branch name if exists
    let branchName = null;
    if (user.branch_id) {
      const [branchRows] = await pool.query(
        'SELECT name FROM branches WHERE id = ?',
        [user.branch_id]
      );
      if (branchRows.length > 0) {
        branchName = branchRows[0].name;
      }
    }

    // Set session
    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role || 'student',
      firstName: user.first_name || 'User',
      lastName: user.last_name || '',
      fullName: `${user.first_name || 'User'} ${user.last_name || ''}`.trim(),
      profileImage: user.profile_image_url,
      branchId: user.branch_id,
      branchName: branchName,
      mustChangePassword: !!user.must_change_password
    };

    // Update last login
    await pool.query(
      'UPDATE profiles SET updated_at = NOW() WHERE id = ?',
      [user.id]
    );

    req.session.save((err) => {
      if (err) {
        console.error('❌ Session save error:', err);
        return res.redirect('/auth/login.html?error=Session error. Please try again.');
      }
      
      console.log('✅ Login successful for:', email);
      
      let redirectUrl = '/admin/dashboard.html';
      if (user.role === 'student') redirectUrl = '/student/dashboard.html';
      if (user.role === 'instructor') {
        redirectUrl = user.must_change_password
          ? '/instructor/change-password.html'
          : '/instructor/dashboard.html';
      }
      
      console.log('🔄 Redirecting to:', redirectUrl);
      
      return res.redirect(redirectUrl);
    });
  } catch (err) {
    console.error('❌ Login error:', err.message);
    res.redirect('/auth/login.html?error=Login failed. Please try again.');
  }
});

// ─── POST /auth/register ──────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { first_name, last_name, password, confirm_password, phone, date_of_birth, branch_id } = req.body;
    const email = (req.body.email || '').trim();

    console.log('📝 Registration attempt for:', email);

    // Validation
    if (!first_name || !last_name || !email || !password || !phone) {
      return res.json({ success: false, error: 'Please fill in all required fields' });
    }
    if (password !== confirm_password) {
      return res.json({ success: false, error: 'Passwords do not match' });
    }
    if (password.length < 8) {
      return res.json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const existingUser = await getUserByEmail(email);
    let userId;

    if (existingUser && existingUser.email_verified) {
      return res.json({
        success: false,
        error: 'An account with this email already exists. Please login instead.'
      });
    }

    if (existingUser) {
      // An unverified sign-up never proved it owns this email, so the new
      // sign-up takes it over (same id, so anything linked to it is kept)
      userId = existingUser.id;
      await pool.query(
        `UPDATE profiles SET password_hash = ?, first_name = ?, last_name = ?, phone = ?,
           date_of_birth = ?, branch_id = ?
         WHERE id = ? AND email_verified = FALSE`,
        [password_hash, first_name, last_name, phone, date_of_birth || null, branch_id || null, userId]
      );
    } else {
      userId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO profiles (
          id, email, password_hash, role, first_name, last_name,
          phone, date_of_birth, branch_id, is_active, email_verified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, email, password_hash, 'student', first_name, last_name,
         phone, date_of_birth || null, branch_id || null, true, false]
      );
    }

    await sendVerificationLink(req, { id: userId, email, first_name });

    res.json({
      success: true,
      message: `Account created! We've sent a verification link to ${email}. It can take a few minutes to arrive. Click it to activate your account, then log in.`
    });
  } catch (err) {
    console.error('❌ Register error:', err.message);
    res.json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

// ─── POST /auth/logout ─────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.json({ success: false, error: 'Logout failed.' });
    }
    res.json({ success: true });
  });
});

// ─── GET /auth/logout ─────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.redirect('/auth/login.html');
  });
});

// ─── GET /auth/me ─────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session?.user) {
    return res.json({ success: false, error: 'Not authenticated' });
  }
  res.json({ success: true, user: req.session.user });
});

// ─── POST /auth/change-password ───────────────────────────
router.post('/change-password', async (req, res) => {
  try {
    if (!req.session?.user) {
      return res.json({ success: false, error: 'Not authenticated' });
    }

    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.json({ success: false, error: 'All fields are required' });
    }

    if (new_password !== confirm_password) {
      return res.json({ success: false, error: 'New passwords do not match' });
    }

    if (new_password.length < 8) {
      return res.json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Get user from database
    const user = await getUserById(req.session.user.id);
    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(current_password, user.password_hash);
    if (!isValidPassword) {
      return res.json({ success: false, error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const new_password_hash = await bcrypt.hash(new_password, saltRounds);

    // Update password
    await pool.query(
      'UPDATE profiles SET password_hash = ?, must_change_password = FALSE WHERE id = ?',
      [new_password_hash, req.session.user.id]
    );

    // Clear must_change_password flag in session
    req.session.user.mustChangePassword = false;

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err.message);
    res.json({ success: false, error: 'Failed to change password' });
  }
});

// ─── GET /auth/verify-email ───────────────────────────────
// The link in the verification email lands here
router.get('/verify-email', async (req, res) => {
  const fail = msg => res.redirect(`/auth/login.html?error=${encodeURIComponent(msg)}`);
  try {
    const { token } = req.query;
    if (!token) return fail('Invalid verification link.');

    const [rows] = await pool.query(
      `SELECT p.id, p.first_name
       FROM email_verification_tokens t
       JOIN profiles p ON p.id = t.user_id
       WHERE t.token_hash = ? AND t.expires_at > NOW()`,
      [hashToken(token)]
    );
    const user = rows[0];
    if (!user) {
      return fail('This verification link is invalid or has expired. If you already verified, just log in — otherwise log in to get a new link.');
    }

    await pool.query('UPDATE profiles SET email_verified = TRUE WHERE id = ?', [user.id]);
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = ?', [user.id]);

    await pool.query(
      `INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        user.id,
        'Welcome to Xolani Driving School! 🎉',
        `Hi ${user.first_name}, your account is ready. Contact us to choose your package and book your first lesson!`,
        'success'
      ]
    );

    res.redirect(`/auth/login.html?success=${encodeURIComponent('Email verified! You can now log in.')}`);
  } catch (err) {
    console.error('Verify email error:', err.message);
    fail('Verification failed. Please try again.');
  }
});

// ─── POST /auth/resend-verification ───────────────────────
router.post('/resend-verification', async (req, res) => {
  try {
    const email = (req.body.email || '').trim();
    if (!email) return res.json({ success: false, error: 'Email is required' });

    // Same response either way, so this can't be used to discover accounts
    const user = await getUserByEmail(email);
    if (user && !user.email_verified && user.is_active) {
      await sendVerificationLink(req, user);
    }
    res.json({ success: true, message: 'If that account still needs verifying, a new link has been sent. It can take a few minutes to arrive, and any of the verification emails you received will work. Check your inbox (and spam folder).' });
  } catch (err) {
    console.error('Resend verification error:', err.message);
    res.json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// ─── POST /auth/forgot-password ────────────────────────────
// Emails a single-use reset link (valid for 1 hour)
const RESET_SENT_MESSAGE = 'If an account exists for that email, a reset link has been sent.';

router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').trim();
    if (!email) {
      return res.json({ success: false, error: 'Email is required' });
    }

    const user = await getUserByEmail(email);

    // Same response whether or not the account exists, so emails can't be enumerated
    if (user && user.is_active) {
      const token = crypto.randomBytes(32).toString('hex');
      await pool.query(
        'UPDATE profiles SET reset_token_hash = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?',
        [hashToken(token), user.id]
      );

      const resetUrl = `${appUrl(req)}/auth/reset-password.html?token=${token}`;

      // Not awaited: response time stays the same whether or not the account exists
      sendPasswordResetEmail({ to: user.email, firstName: user.first_name, resetUrl })
        .catch(err => console.error('Reset email failed:', err.message));
    }

    res.json({ success: true, message: RESET_SENT_MESSAGE });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// ─── POST /auth/reset-password ────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirm_password } = req.body;

    if (!token || !password || !confirm_password) {
      return res.json({ success: false, error: 'All fields are required' });
    }
    if (password !== confirm_password) {
      return res.json({ success: false, error: 'Passwords do not match' });
    }
    if (password.length < 8) {
      return res.json({ success: false, error: 'Password must be at least 8 characters' });
    }

    const [rows] = await pool.query(
      'SELECT id, email, first_name FROM profiles WHERE reset_token_hash = ? AND reset_token_expires > NOW() AND is_active = TRUE',
      [hashToken(token)]
    );
    const user = rows[0];
    if (!user) {
      return res.json({ success: false, error: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    // Clearing the token makes the link single-use. Using an emailed link also
    // proves the user owns the inbox, so the email counts as verified.
    await pool.query(
      `UPDATE profiles
       SET password_hash = ?, must_change_password = FALSE, reset_token_hash = NULL, reset_token_expires = NULL,
           email_verified = TRUE
       WHERE id = ?`,
      [password_hash, user.id]
    );
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = ?', [user.id]);

    sendPasswordChangedEmail({ to: user.email, firstName: user.first_name })
      .catch(err => console.error('Password changed email failed:', err.message));

    res.json({ success: true, message: 'Password updated successfully. You can now log in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.json({ success: false, error: 'Failed to reset password. Please try again.' });
  }
});

module.exports = router;