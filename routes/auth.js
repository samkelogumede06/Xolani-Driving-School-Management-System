const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const crypto = require('crypto');

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
    const { first_name, last_name, email, password, confirm_password, phone, date_of_birth, branch_id } = req.body;

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

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.json({ 
        success: false, 
        error: 'An account with this email already exists. Please login instead.' 
      });
    }

    // Hash password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Generate UUID for user
    const userId = crypto.randomUUID();

    // Insert user into profiles
    const [result] = await pool.query(
      `INSERT INTO profiles (
        id, email, password_hash, role, first_name, last_name, 
        phone, date_of_birth, branch_id, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        email,
        password_hash,
        'student',
        first_name,
        last_name,
        phone,
        date_of_birth || null,
        branch_id || null,
        true
      ]
    );

    console.log('✅ User created:', userId);

    // Send welcome notification
    await pool.query(
      `INSERT INTO notifications (id, user_id, title, message, type) 
       VALUES (?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        userId,
        'Welcome to Xolani Driving School! 🎉',
        `Hi ${first_name}, your account is ready. Contact us to choose your package and book your first lesson!`,
        'success'
      ]
    );

    console.log('✅ Registration successful for:', email);

    res.json({ 
      success: true, 
      message: 'Account created! You can now login.' 
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

// ─── POST /auth/forgot-password ────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.redirect('/auth/forgot-password.html?error=Email is required');
    }
    
    // Check if user exists
    const user = await getUserByEmail(email);
    if (!user) {
      // Don't reveal if user exists or not for security
      return res.redirect('/auth/login.html?success=If an account exists, a reset link has been sent.');
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    // Store reset token in database (add column if needed)
    // For now, we'll just send a message
    // You'll need to add reset_token and reset_token_expiry columns to profiles table
    
    console.log('🔑 Password reset requested for:', email);
    console.log('   Reset token:', resetToken);

    // TODO: Send email with reset link
    // For now, just show success message
    
    res.redirect('/auth/login.html?success=If an account exists, a reset link has been sent.');
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.redirect('/auth/forgot-password.html?error=Something went wrong. Please try again.');
  }
});

// ─── POST /auth/reset-password ────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, confirm_password } = req.body;
    
    if (!token || !password || !confirm_password) {
      return res.redirect('/auth/reset-password.html?error=All fields are required');
    }
    if (password !== confirm_password) {
      return res.redirect('/auth/reset-password.html?error=Passwords do not match');
    }
    if (password.length < 8) {
      return res.redirect('/auth/reset-password.html?error=Password must be at least 8 characters');
    }

    // TODO: Verify token from database
    // For now, show success message
    console.log('🔑 Password reset with token:', token);

    res.redirect('/auth/login.html?success=Password updated successfully. You can now login with your new password.');
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.redirect('/auth/reset-password.html?error=Failed to reset password. Please try again.');
  }
});

module.exports = router;