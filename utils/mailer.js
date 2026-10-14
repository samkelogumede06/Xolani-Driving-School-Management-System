/**
 * Xolani Driving School — Email sending
 * Two ways to send, configured in .env:
 *   - BREVO_API_KEY: Brevo's HTTPS API. Use this on hosts that block SMTP ports.
 *   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS: any SMTP server, e.g. Gmail.
 * MAIL_FROM sets the sender, e.g. "Xolani Driving School <you@gmail.com>".
 */
const nodemailer = require('nodemailer');

const brevoApiKey = process.env.BREVO_API_KEY;
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const transporter = !brevoApiKey && smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    })
  : null;

const mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER || '';

// "Name <email>" → { name, email }, as the Brevo API expects
function parseAddress(address) {
  const match = address.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? { name: match[1] || undefined, email: match[2] } : { email: address.trim() };
}

async function sendWithBrevo({ to, subject, text, html }) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: parseAddress(mailFrom),
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html
    })
  });
  if (!response.ok) {
    throw new Error(`Brevo API ${response.status}: ${await response.text()}`);
  }
}

async function sendMail(message) {
  if (brevoApiKey) return sendWithBrevo(message);

  if (!transporter) {
    // Without email settings, print the email locally so the flow can still be tested
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n📧 [Email not sent — email not configured]\n   To: ${message.to}\n   Subject: ${message.subject}\n\n${message.text}\n`);
      return;
    }
    throw new Error('Email is not configured');
  }

  await transporter.sendMail({ from: mailFrom, ...message });
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function layout(bodyHtml) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
    <div style="background:#0f2a4a;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;font-weight:700;font-size:18px">
      Xolani Driving School
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px;line-height:1.6">
      ${bodyHtml}
    </div>
  </div>`;
}

function sendPasswordResetEmail({ to, firstName, resetUrl }) {
  return sendMail({
    to,
    subject: 'Reset your Xolani Driving School password',
    text:
`Hi ${firstName},

We received a request to reset your password. Open the link below to choose a new one:

${resetUrl}

This link expires in 1 hour and can only be used once.
If you didn't request this, you can ignore this email — your password won't change.

Xolani Driving School`,
    html: layout(`
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>We received a request to reset your password. Click the button below to choose a new one.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${resetUrl}" style="background:#f5a623;color:#0f2a4a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700">Reset Password</a>
      </p>
      <p style="font-size:13px;color:#6b7280">This link expires in 1 hour and can only be used once. If you didn't request this, you can ignore this email — your password won't change.</p>`)
  });
}

function sendVerificationEmail({ to, firstName, verifyUrl }) {
  return sendMail({
    to,
    subject: 'Verify your email — Xolani Driving School',
    text:
`Hi ${firstName},

Welcome to Xolani Driving School! Please confirm your email address by opening the link below:

${verifyUrl}

This link expires in 24 hours. If you didn't create an account, you can ignore this email.

Xolani Driving School`,
    html: layout(`
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Welcome to Xolani Driving School! Please confirm your email address to activate your account.</p>
      <p style="text-align:center;margin:28px 0">
        <a href="${verifyUrl}" style="background:#f5a623;color:#0f2a4a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700">Verify My Email</a>
      </p>
      <p style="font-size:13px;color:#6b7280">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`)
  });
}

function sendPasswordChangedEmail({ to, firstName }) {
  return sendMail({
    to,
    subject: 'Your Xolani Driving School password was changed',
    text:
`Hi ${firstName},

Your password was just changed. If this was you, no action is needed.
If you didn't change it, contact us immediately on +27 79 592 5530.

Xolani Driving School`,
    html: layout(`
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Your password was just changed. If this was you, no action is needed.</p>
      <p>If you didn't change it, contact us immediately on <strong>+27 79 592 5530</strong>.</p>`)
  });
}

// Called on startup so a missing or wrong SMTP setup is obvious straight away
async function verifyMailer() {
  if (brevoApiKey) {
    try {
      const response = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': brevoApiKey, accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log(`📧  Email: Brevo API ready (sending as ${parseAddress(mailFrom).email})`);
      return true;
    } catch (err) {
      console.error(`❌  Email: Brevo API key rejected — ${err.message}`);
      return false;
    }
  }
  if (!transporter) {
    console.warn('⚠️  Email: not configured — emails will be printed to this console, not sent.');
    return false;
  }
  try {
    await transporter.verify();
    console.log(`📧  Email: SMTP ready (${process.env.SMTP_HOST} as ${process.env.SMTP_USER})`);
    return true;
  } catch (err) {
    console.error(`❌  Email: SMTP login failed — ${err.message}`);
    return false;
  }
}

module.exports = { sendPasswordResetEmail, sendPasswordChangedEmail, sendVerificationEmail, verifyMailer };
