🚗 Xolani's Driving School – Setup Guide
A digital transformation system for a real driving school in KwaZulu-Natal, South Africa. Built with Node.js + Express.js + Supabase PostgreSQL. Features student and admin portals, QR attendance, AI-powered readiness scoring, payments, vehicle tracking, and a business intelligence dashboard.

📋 Requirements
Tool	Purpose
Node.js (v18+)	JavaScript runtime for the backend server
npm	Package manager (comes with Node.js)
Supabase	PostgreSQL database + Authentication
VS Code	To browse and edit the code
Any modern browser	Chrome, Firefox, Edge
🚀 Quick Start (10 minutes)
1. Install Node.js
Download and install Node.js from nodejs.org (LTS version recommended)

Verify installation by opening a terminal/command prompt and running:

bash
node --version
npm --version
Both commands should display version numbers

2. Clone and Install Dependencies
bash
git clone <your-repo-url>
cd xolani-driving-school
npm install
This will install all required packages from package.json:

express – Web server framework

@supabase/supabase-js – Database client

express-session – User session management

bcrypt – Password hashing

qrcode – QR code generation

chart.js – Charts on reports page

helmet – Security headers

express-rate-limit – API rate limiting

3. Set Up Supabase
Go to supabase.com and create a new account (free tier works)

Click New Project and fill in:

Name: xolani-driving-school

Database Password: Choose a strong password (save it)

Region: Choose the closest to South Africa (e.g., eu-west-1 or us-east-1)

Wait ~2 minutes for the database to be created

Once ready, go to SQL Editor in the left sidebar

Create a new query and paste the entire contents of database-schema.sql

Click Run – you should see "Success. No rows returned"

Go to Authentication → Users → Add User and create:

Admin: admin@xolanidriving.co.za / Admin123!

Student: student@xolanidriving.co.za / Student123!
4. Configure Environment Variables
bash
cp .env.example .env
Open the .env file in VS Code and fill in your Supabase credentials:

env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_KEY=your-service-role-key-here

# Server Configuration
SESSION_SECRET=your-secret-key-here
PORT=3000
APP_URL=http://localhost:3000

# Environment
NODE_ENV=development
How to find your keys:

SUPABASE_URL – Found in Project Settings → API → Project URL

SUPABASE_ANON_KEY – Found in Project Settings → API → Project API Keys (anon public)

SUPABASE_SERVICE_KEY – Found in Project Settings → API → Project API Keys (service_role) – keep this secret!

5. Start the Application
bash
npm start
For development with auto-reload on changes:

bash
npm run dev
You should see:

text
✅ Server running on http://localhost:3000
✅ Connected to Supabase
6. Open the App
Visit in your browser: http://localhost:3000

⚠️ Important: Do not open the HTML files directly. The app must be served through Node.js (Express) because it uses backend API endpoints and database connections.

🔑 Demo Login Accounts
Student Portal — http://localhost:3000/auth/login
Role	Username	Password
Student	student@xolanidriving.co.za	Student123!
Student	(Create new users via Supabase Auth → Users → Add User)	
Admin Portal — http://localhost:3000/auth/login
Role	Username	Password
Admin	admin@xolanidriving.co.za	Admin123!
📁 Project Structure
text
xolani-driving-school/
│
├── server.js                     # Express server (entry point)
├── package.json                  # Dependencies
├── .env                          # Environment variables (create from .env.example)
├── database-schema.sql           # Supabase SQL schema (import first)
│
├── routes/
│   ├── api.js                    # All /api/* endpoints (lessons, students, etc.)
│   └── auth.js                   # /auth/login, /auth/register, /auth/logout
│
├── utils/
│   └── aiPredictions.js          # AI test readiness + dropout risk engine
│
├── public/                       # All static files served directly
│   ├── index.html                # Home / landing page
│   ├── about.html                # About page
│   ├── pricing.html              # Pricing page
│   ├── contact.html              # Contact page
│   │
│   ├── css/
│   │   └── style.css             # Master stylesheet (navy + amber theme)
│   │
│   ├── js/
│   │   └── app.js                # Master JavaScript
│   │
│   ├── auth/
│   │   ├── login.html            # Login page
│   │   └── register.html         # Registration page
│   │
│   ├── student/                  # STUDENT PORTAL
│   │   ├── dashboard.html        # Main dashboard + stats + QR code
│   │   ├── lessons.html          # Lesson history + booking
│   │   ├── attendance.html       # Attendance history + rate
│   │   ├── progress.html         # AI readiness score + progress
│   │   ├── payments.html         # Payment history + submit payment
│   │   ├── notifications.html    # System notifications
│   │   ├── profile.html          # Edit profile + emergency contacts
│   │   └── scan-qr.html          # QR code attendance scanner
│   │
│   └── admin/                    # ADMIN PORTAL
│       ├── dashboard.html        # KPIs + today's schedule + AI summary
│       ├── students.html         # Manage students + AI risk badges
│       ├── instructors.html      # Manage instructors + availability
│       ├── vehicles.html         # Fleet management + roadworthy alerts
│       ├── packages.html         # Manage pricing packages
│       ├── schedule.html         # Daily calendar + lesson booking
│       ├── attendance.html       # Attendance records + QR stats
│       ├── payments.html         # Record payments + CSV export
│       ├── reports.html          # Revenue charts + Power BI embed
│       ├── ai-insights.html      # AI readiness + dropout risk per student
│       └── inquiries.html        # Contact form submissions
└──
✨ Key Features
Public Website (No Login Required)
Page	Features
Home	Hero section, services, statistics, testimonials, pricing preview, branch locations
About	Company story, mission/vision, values, team, accreditations
Pricing	All 6 packages with full details and FAQ
Contact	Both branches with clickable Google Maps links, contact form
Student Portal (Login Required)
Page	Features
Dashboard	Stats, AI readiness score, dropout risk, upcoming lessons, notifications
My Lessons	Full lesson history with filters, QR attendance instructions
Attendance	Attendance history with rate visualization
Progress	AI readiness breakdown, skill areas, score history, package progress
Payments	Payment history, balance due, payment instructions
Notifications	All system notifications with mark-as-read
Profile	Edit personal info, emergency contacts
QR Scan	Dedicated QR code attendance landing page
Admin Portal (Login Required)
Page	Features
Dashboard	KPI stats, branch overview, today's schedule, quick actions, AI summary
Students	Full CRUD, search/filter, AI risk badges, enrolment modal, CSV export
Instructors	Card view, add/manage instructors, availability toggle
Vehicles	Fleet management, roadworthy expiry warnings
Packages	Create/edit/deactivate pricing packages
Schedule	Daily calendar (list + timeline views), lesson booking, QR generation
Attendance	Mark present/absent manually, QR scan stats
Payments	Record payments, date/method filters, CSV export
Reports	Revenue charts, lesson type doughnut, enrollment trend, Power BI embed
AI Insights	Test readiness + dropout risk for all students, high-risk alerts
Inquiries	Contact form submissions with reply, WhatsApp, call actions
📱 How the QR Attendance System Works
Admin schedules a lesson → System generates a unique QR token with student ID + lesson time

Student opens their Student Dashboard → Their QR code is displayed

Admin opens admin/scan-qr.html → Click "Scan QR" button

Student holds their phone with QR code to the webcam

System decodes the QR token and validates:

Student exists

Lesson is scheduled for today

Within ±3 hours of scheduled time

Attendance recorded in the database

Student receives a notification: "Attendance confirmed for today's lesson"

Alternative method: Admin can manually select a student from the dropdown on the Scan page.

🧠 How the AI Readiness Score Works
The score is calculated per student using a weighted formula in utils/aiPredictions.js:

Factor	Weight	How it's measured
Lesson Progress	25%	Lessons attended ÷ course target lessons
Attendance Rate	20%	Present scans ÷ total scheduled lessons
Average Score	25%	Instructor ratings from completed lessons
Instructor Rating	15%	Average feedback score from instructors
Recent Performance	10%	Trend from last 5 lessons
Improvement Trend	5%	Overall trend direction (improving/declining)
Output Categories:

✅ Ready for Test (≥80%)
🔶 Nearly Ready (65–79%)
📘 In Progress (40–64%)
⚠️ Needs More Training (<40%)

Dropout Risk Score (Separate Algorithm)
Factor	Weight
Missed lessons rate	35%
Consecutive misses	25%
Days since last lesson	20%
Payment issues	15%
Attendance trend	5%
Risk Levels with Action Recommendations:

🟢 Low – No action needed

🟡 Medium – Send motivational SMS, offer rescheduling options

🔴 High – Admin alert, schedule parent/guardian meeting

🔒 Security Features
Layer	Implementation
Authentication	Express-session with JWT via Supabase Auth
Authorization	Role-based access (student / admin / super_admin)
Headers	Helmet.js for security headers
Rate Limiting	API and auth routes protected against brute force
Database	Supabase Row Level Security (RLS) policies
Passwords	Bcrypt hashing (never stored in plain text)
Environment	Service key used server-side only (never exposed to client)
📊 Power BI Integration
Publish your Power BI report to Power BI Service

Go to File → Embed Report → Copy the embed URL

In public/admin/reports.html, replace YOUR_EMBED_TOKEN_HERE in the iframe src

Click the "Load Power BI Dashboard" button in the Reports page

🛠 Tech Stack
Layer	Technology
Backend	Node.js, Express.js
Database	Supabase (PostgreSQL)
Authentication	Supabase Auth (JWT sessions)
Frontend	HTML5, CSS3, Vanilla JavaScript
Charts	Chart.js (reports page)
QR Codes	qrcode npm package
BI	Power BI embed (configurable)
Icons	Font Awesome 6
Fonts	Google Fonts (Sora + DM Sans)
🎨 Design System
Element	Specification
Primary	Deep Navy #0f2a4a
Accent	Amber Gold #f5a623
Font Display	Sora (headings)
Font Body	DM Sans
Border Radius	12px (cards), 20px (large panels)
Layout	Mobile-first, fully responsive with sidebar toggle on mobile
🚀 Deployment Instructions
Deploy to Railway (Recommended)
bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Deploy
railway up

# Add environment variables in Railway Dashboard
Deploy to Render
bash
# Push your code to GitHub
# Go to render.com → New Web Service → Connect repository
# Set:
#   - Build Command: npm install
#   - Start Command: npm start
# Add environment variables (SUPABASE_URL, SUPABASE_ANON_KEY, SESSION_SECRET)
# Deploy!
Deploy to Heroku
bash
heroku create xolani-driving-school
heroku config:set $(cat .env | xargs)
git push heroku main
⚠️ Note: Serverless platforms like Vercel/Netlify will NOT work because this is a Node.js server application, not static files.

❓ Common Issues & Solutions
Issue	Solution
"Database connection failed"	Make sure Supabase is running and your .env keys are correct
"Cannot find module"	Run npm install again
Login says "Invalid credentials"	Make sure users exist in Supabase Auth → Users
Page loads but no data	Check that you're on http://localhost:3000 not file://
QR download shows blank page	The qrcode package uses an API; check your internet connection
Uploads not saving	Make sure public/ has write permissions for the process
Port 3000 already in use	Change PORT in .env to another port (e.g., 3001)
Supabase RLS errors	Check that RLS policies are applied in database-schema.sql
📝 License
© 2024 Xolani's Driving School. All rights reserved.
Built as a Digital Transformation Project for IS3.