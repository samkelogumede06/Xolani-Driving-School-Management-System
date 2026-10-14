require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ─── DATABASE CONNECTION ─────────────────────────────────────
const { pool, testConnection } = require('./config/db');
const { verifyMailer } = require('./utils/mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// In production a real secret is required: anyone who knows it can forge logins
if (isProduction && !process.env.SESSION_SECRET) {
  console.error('❌ SESSION_SECRET must be set in production. Server will not start.');
  process.exit(1);
}

// Hosts like Render and Railway sit behind a proxy that handles HTTPS. Trusting it
// lets secure cookies work and lets rate limiting see each visitor's real IP.
app.set('trust proxy', 1);

// ─── MIDDLEWARE ──────────────────────────────────────────────
app.use(morgan('dev'));
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // ⭐ ALLOW inline scripts for legacy code
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "cdn.jsdelivr.net",
        "cdnjs.cloudflare.com",
        "unpkg.com"
      ],
      // ⭐ style-src needs 'unsafe-inline' for Google Fonts and inline styles
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "cdn.jsdelivr.net",
        "cdnjs.cloudflare.com",
        "fonts.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "fonts.gstatic.com",
        "cdnjs.cloudflare.com"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "*"
      ],
      connectSrc: [
        "'self'"
        // ⭐ REMOVED supabase.co - not needed anymore
      ],
      frameSrc: [
        "'self'",
        "app.powerbi.com",
        "*.google.com",
        "maps.google.com"
      ],
      upgradeInsecureRequests: []
    }
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));
app.use('/auth/', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }));

// ─── SESSION CONFIGURATION ──────────────────────────────────
// Sessions are stored in MySQL (a `sessions` table is created automatically),
// so users stay logged in when the server restarts
const sessionStore = new MySQLStore({}, pool);

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-secret-not-for-production',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax'
  }
}));

// ─── STATIC FILES ────────────────────────────────────────────
// Serve all HTML files from public/
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  index: 'index.html',
  setHeaders(res, filePath) {
    if (process.env.NODE_ENV !== 'production' && /\.(html|css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

// ─── HEALTH CHECK ENDPOINT ──────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    const [result] = await pool.query('SELECT 1 as health');
    res.json({ 
      status: 'healthy', 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected'
    });
  }
});

// ─── API ROUTES ──────────────────────────────────────────────
app.use('/api', require('./routes/api'));
app.use('/auth', require('./routes/auth'));

// ─── SPA FALLBACK for clean URLs ─────────────────────────────
// Redirect /student → /student/dashboard.html etc.
app.get('/student', (req, res) => res.redirect('/student/dashboard.html'));
app.get('/admin', (req, res) => res.redirect('/admin/dashboard.html'));
app.get('/instructor', (req, res) => res.redirect('/instructor/dashboard.html'));

// ─── 404 ─────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html><html><head><title>404 — Xolani DS</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8f9fc}
    .box{text-align:center;padding:48px}.icon{font-size:4rem;margin-bottom:16px}.h{font-size:1.5rem;color:#0f2a4a;font-weight:700;margin-bottom:8px}
    p{color:#6b7280;margin-bottom:24px}a{background:#f5a623;color:#0f2a4a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700}</style>
    </head><body><div class="box"><div class="icon">🚗</div><div class="h">Page Not Found</div><p>The page you're looking for doesn't exist.</p><a href="/">Back to Home</a></div></body></html>`);
});

// ─── ERROR HANDLER ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ success: false, error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error' });
  }
  res.status(500).send('<h1>500 — Server Error</h1><p>Something went wrong. Please try again.</p>');
});

// ─── START SERVER ────────────────────────────────────────────
async function startServer() {
  // Test database connection before starting
  const dbConnected = await testConnection();
  
  if (!dbConnected) {
    console.error('❌ Database connection failed. Server will not start.');
    console.error('   Please check your MySQL credentials in .env');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n🚗  Xolani Driving School Platform`);
    console.log(`✅  Running → http://localhost:${PORT}`);
    console.log(`📱  Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️  Database: MySQL (connected)`);
    verifyMailer().then(() => console.log(''));
  });
}

// Start the server
startServer();

module.exports = app;