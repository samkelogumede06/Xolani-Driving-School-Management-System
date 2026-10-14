# Xolani Driving School — Management Platform

A full-stack web platform for a driving school with two branches in Umlazi, KwaZulu-Natal. It replaces paper-based admin with a public website plus three role-based portals for students, instructors and administrators.

**Stack:** Node.js · Express · MySQL · HTML/CSS/vanilla JavaScript

## 🔗 Live demo

**https://xolani-driving-school.onrender.com**

| Role | Email | Password |
|---|---|---|
| Admin | admin@xolanidriving.co.za | Admin123! |
| Student | student@xolanidriving.co.za | Student123! |

You can also register your own student account (a verification email is sent), or add an instructor from the admin portal.

> ⏳ **The first load may take up to a minute.** The demo runs on free hosting (Render + Aiven + Brevo), which sleeps after 15 minutes without visitors. After it wakes up, it's fast.

---

## Features

### Public website
- Home, About, Pricing and Contact pages
- Branch details with Google Maps links
- Contact form that saves enquiries for the admin team

### Student portal
- Dashboard with upcoming lessons, notifications and a test-readiness score
- Progress page with per-skill averages from the instructor's lesson ratings
- Book lessons by choosing an available instructor and time slot
- Lesson history, attendance record and payment history
- **QR attendance:** scan the lesson's QR code with a phone to check in
- Profile with emergency contact details

### Instructor portal
- Dashboard and list of their own lessons
- Update lesson status, add notes, score the student and rate 5 driving skills (vehicle control, road awareness, parking & yard, observation, K53 rules)
- Generate a lesson's QR code and mark attendance manually
- Set availability, view notifications and student insights
- Forced password change on first login (admins create instructor accounts with a temporary password)

### Admin portal
- KPI dashboard across both branches
- Manage students, enrolments, instructors, vehicles and packages
- Daily schedule with lesson booking and QR code generation
- Attendance records, payments (with CSV export) and enquiries
- Reports with Chart.js charts built from live data: revenue, enrolments and attendance over the last 6 months, this month's lesson types, and a per-branch comparison
- Insights page with test-readiness and dropout-risk scores for every student

---

## How it works

### QR attendance
1. When a lesson is scheduled, the server creates a unique token and a QR code that links to `/student/scan-qr.html?token=…`.
2. The student scans the code while logged in.
3. The server checks that the lesson belongs to that student, hasn't already been marked, and that the scan is between 30 minutes before and 3 hours after the lesson start.
4. If all checks pass, attendance is recorded and the lesson is updated.

### Readiness and dropout-risk scoring
[`utils/aiPredictions.js`](utils/aiPredictions.js) contains two rule-based, weighted scoring models (not machine learning). They're calculated live from each student's lessons, active enrolment and payment balance whenever a dashboard loads.

**Test readiness (0–100)**

| Factor | Weight | Source |
|---|---|---|
| Lesson progress | 30% | Completed lessons ÷ lessons in the student's package |
| Attendance rate | 20% | Attended ÷ (attended + no-shows) |
| Average lesson score | 25% | Instructor's 0–100 score on completed lessons |
| Recent performance | 20% | Average of the last 3 scored lessons |
| Improvement trend | 5% | Latest score compared with the first |

A completed yard test scored 50 or higher adds 5 points, and each no-show subtracts 2. Results: **Ready** (85+), **Nearly Ready** (70–84), **In Progress** (50–69), **Needs More Training** (below 50), each with recommendations. The "pass probability" shown alongside is a simple estimate derived from this score.

**Dropout risk (0–100)**

| Factor | Points |
|---|---|
| No-show rate | up to 30 |
| Consecutive no-shows (1 / 2 / 3+) | 10 / 20 / 30 |
| Days since last attended lesson (>7 / >14 / >30), ignored if a lesson is booked | 5 / 15 / 25 |
| Share of package price still unpaid | up to 20 |
| Attendance trend (last 3 lessons vs earlier ones) | +15 declining, −10 improving |

Results: **Low** (below 35), **Medium** (35–64), **High** (65+).

### Email verification
1. A new sign-up is created as unverified, and a "Verify My Email" link is emailed to the address. Each link is valid for 24 hours. Every link sent keeps working until the account is verified, because emails can arrive late or out of order and people often sign up or resend twice.
2. Unverified accounts can't log in. The login page explains why and offers a **Resend verification email** button.
3. If someone registers with another person's email, they can't use the account because they can't open the link. When the real owner signs up, they take the unverified account over.
4. Accounts created by an admin (instructors) and accounts that existed before this feature count as verified. Completing a password reset also verifies the email, since it proves the user can read that inbox.

### Password reset
1. The user enters their email on the Forgot Password page. The response is the same whether or not the account exists, so it can't be used to discover registered emails.
2. The server creates a random token, stores only its SHA-256 hash with a 1-hour expiry, and emails a link to `/auth/reset-password.html?token=…`.
3. When the new password is submitted, the token is checked against the stored hash and expiry. The password is updated and the token is cleared, so each link works once.
4. A "your password was changed" email is sent as a security notice.

### Security
- Passwords hashed with bcrypt
- Server-side sessions stored in MySQL (`express-session` + `express-mysql-session`, httpOnly secure cookies), so logins survive restarts
- Database error details are logged on the server, never sent to the browser in production
- The server refuses to start in production without a `SESSION_SECRET`
- Role-based route protection for student, instructor and admin APIs
- Instructors can only view and update their own lessons
- Helmet security headers and a Content Security Policy
- Rate limiting on `/api` and `/auth` routes
- Parameterised SQL queries throughout (`mysql2`)

---

## Running it locally

### Requirements
- Node.js 18 or newer
- MySQL 8 (MySQL Workbench, phpMyAdmin or the CLI)

### 1. Install dependencies
```bash
git clone https://github.com/samkelogumede06/Xolani-Driving-School-Management-System.git
cd Xolani-Driving-School-Management-System
npm install
```

### 2. Create the database
```sql
CREATE DATABASE xolani_driving_school;
USE xolani_driving_school;
```
Then run the whole of [`database-schema-mysql.sql`](database-schema-mysql.sql). It creates all tables and seeds the two branches and the lesson packages.

### 3. Configure environment variables
Create a `.env` file in the project root:
```env
# Server
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:3000
SESSION_SECRET=replace-with-a-long-random-string

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=xolani_driving_school
# Hosted MySQL that requires SSL (e.g. Aiven): paste the provider's CA certificate
DB_SSL_CA=

# Email: fill in SMTP, or set BREVO_API_KEY instead (it takes priority)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
BREVO_API_KEY=
MAIL_FROM="Xolani Driving School <you@gmail.com>"
```
Fill in your MySQL credentials and set `SESSION_SECRET` to a long random string.

For verification and password-reset emails, either fill in the `SMTP_*` settings (for example a Gmail [app password](https://support.google.com/accounts/answer/185833)) or set `BREVO_API_KEY` to send through [Brevo](https://www.brevo.com)'s API. In development you can leave them blank, and each email (including its link) is printed to the server console instead. On startup the server reports whether email is working.

### 4. Create an admin account
The schema doesn't create any users. Generate a password hash:
```bash
node -e "require('bcrypt').hash('Admin123!', 10).then(console.log)"
```
Then insert the admin, pasting in the hash:
```sql
INSERT INTO profiles (email, password_hash, role, first_name, last_name)
VALUES ('admin@xolanidriving.co.za', '<paste-hash-here>', 'admin', 'System', 'Admin');
```
- **Students** sign up at `/auth/register.html` and must click the emailed verification link before logging in
- **Instructors** are added by an admin on the Instructors page, which returns a temporary password

### 5. Start the server
```bash
npm run dev   # auto-reloads with nodemon
# or
npm start
```
Open http://localhost:3000. The app must run through the Express server; opening the HTML files directly won't work.

---

## Deploying

The app needs a Node.js host plus a MySQL database (static hosts like Vercel or Netlify won't work).

The live demo runs entirely on free plans: **Render** (web service), **Aiven** (MySQL, encrypted with `DB_SSL_CA`) and **Brevo** (email API, because Render's free plan blocks SMTP ports). Times and dates use South African time (UTC+2) regardless of the server's time zone.

1. Create the database by running `database-schema-mysql.sql`, then create an admin account (step 4 above). For an existing database, run the files in `migrations/` instead, oldest first.
2. Set the environment variables listed in step 3 above on the host. Use `NODE_ENV=production`, a long random `SESSION_SECRET`, `APP_URL` set to the live URL (used in email links), and your database and email settings.
3. Build command `npm install`, start command `npm start`.

Many hosts block SMTP ports, especially on free plans. If the startup log shows the SMTP connection failing, use `BREVO_API_KEY` instead.

---

## Project structure

```
├── server.js                  # Express app: security middleware, sessions, static files, routes
├── config/db.js               # MySQL connection pool
├── routes/
│   ├── auth.js                # Login, register, logout, email verification, change and reset password
│   └── api.js                 # Student, instructor, admin and public API endpoints
├── utils/
│   ├── aiPredictions.js       # Readiness and dropout-risk scoring
│   └── mailer.js              # Verification and password reset emails (Nodemailer)
├── database-schema-mysql.sql  # Full schema and seed data
├── migrations/                # Incremental changes for older databases
└── public/
    ├── index.html, about.html, pricing.html, contact.html
    ├── css/style.css          # Shared stylesheet
    ├── js/app.js              # Shared helpers (API calls, toasts, modals, formatting)
    ├── auth/                  # Login, register, password pages
    ├── student/               # Student portal
    ├── instructor/            # Instructor portal
    └── admin/                 # Admin portal
```

### Database tables
`branches`, `profiles` (all users, with a `role` column), `instructors`, `vehicles`, `packages`, `enrollments`, `lessons`, `payments`, `notifications`, `ai_predictions`, `contact_submissions`, `testimonials`

---

## Known limitations and next steps
- **Automated tests** — none yet.

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Database | MySQL (`mysql2`) |
| Auth | `express-session`, bcrypt |
| Security | Helmet, express-rate-limit |
| Frontend | HTML5, CSS3, vanilla JavaScript |
| Charts | Chart.js |
| QR codes | `qrcode` |
| Email | Nodemailer (SMTP) |
| Icons and fonts | Font Awesome, Google Fonts |

---

## Author
**Samkelo Gumede** — [GitHub](https://github.com/samkelogumede06)


