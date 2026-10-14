-- ============================================================
--  XOLANI DRIVING SCHOOL — MYSQL SCHEMA
--  Run this entire file in MySQL (phpMyAdmin, MySQL Workbench, or CLI)
-- ============================================================

-- Drop tables in reverse order (avoid foreign key errors)
DROP TABLE IF EXISTS ai_predictions;
DROP TABLE IF EXISTS contact_submissions;
DROP TABLE IF EXISTS testimonials;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS lessons;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS packages;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS instructors;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS branches;

-- ============================================================
-- BRANCHES
-- ============================================================
CREATE TABLE branches (
  id               CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name             VARCHAR(100) NOT NULL,
  address          TEXT NOT NULL,
  city             VARCHAR(50) NOT NULL,
  phone            VARCHAR(20),
  email            VARCHAR(100),
  google_maps_url  TEXT,
  latitude         DECIMAL(10,8),
  longitude        DECIMAL(11,8),
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- PROFILES (extends auth.users - we'll manage users ourselves)
-- ============================================================
CREATE TABLE profiles (
  id                         CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  email                      VARCHAR(255) UNIQUE NOT NULL,
  password_hash              VARCHAR(255) NOT NULL,
  role                       VARCHAR(20) NOT NULL DEFAULT 'student'
                             CHECK (role IN ('student','instructor','admin','super_admin')),
  first_name                 VARCHAR(50) NOT NULL,
  last_name                  VARCHAR(50) NOT NULL,
  phone                      VARCHAR(20),
  id_number                  VARCHAR(20),
  date_of_birth              DATE,
  address                    TEXT,
  city                       VARCHAR(50),
  branch_id                  CHAR(36),
  profile_image_url          TEXT,
  emergency_contact_name     VARCHAR(100),
  emergency_contact_phone    VARCHAR(20),
  must_change_password       BOOLEAN DEFAULT FALSE,
  reset_token_hash           CHAR(64),
  reset_token_expires        DATETIME,
  email_verified             BOOLEAN NOT NULL DEFAULT TRUE,  -- self sign-ups start as FALSE until the emailed link is clicked
  verify_token_hash          CHAR(64),
  verify_token_expires       DATETIME,
  is_active                  BOOLEAN DEFAULT TRUE,
  created_at                 TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                 TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- ============================================================
-- INSTRUCTORS
-- ============================================================
CREATE TABLE instructors (
  id                 CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  profile_id         CHAR(36) NOT NULL,
  branch_id          CHAR(36),
  license_number     VARCHAR(50),
  license_expiry     DATE,
  specializations    JSON,  -- MySQL stores arrays as JSON
  years_experience   INT DEFAULT 0,
  rating             DECIMAL(3,2) DEFAULT 0,
  total_students     INT DEFAULT 0,
  bio                TEXT,
  is_available       BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- ============================================================
-- VEHICLES
-- ============================================================
CREATE TABLE vehicles (
  id                    CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  branch_id             CHAR(36),
  make                  VARCHAR(50) NOT NULL,
  model                 VARCHAR(50) NOT NULL,
  year                  INT,
  registration_number   VARCHAR(20) UNIQUE NOT NULL,
  transmission          VARCHAR(20) CHECK (transmission IN ('manual','automatic')),
  color                 VARCHAR(30),
  image_url             TEXT,
  roadworthy_expiry     DATE,
  service_due_date      DATE,
  is_active             BOOLEAN DEFAULT TRUE,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- ============================================================
-- PACKAGES / PRICING
-- ============================================================
CREATE TABLE packages (
  id                    CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name                  VARCHAR(100) NOT NULL,
  description           TEXT,
  lesson_count          INT NOT NULL,
  price                 DECIMAL(10,2) NOT NULL,
  validity_days         INT DEFAULT 90,
  transmission_type     VARCHAR(20) DEFAULT 'both'
                        CHECK (transmission_type IN ('manual','automatic','both')),
  includes_yard_test    BOOLEAN DEFAULT FALSE,
  includes_road_test    BOOLEAN DEFAULT FALSE,
  is_popular            BOOLEAN DEFAULT FALSE,
  is_active             BOOLEAN DEFAULT TRUE,
  sort_order            INT DEFAULT 0,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ENROLLMENTS
-- ============================================================
CREATE TABLE enrollments (
  id                  CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  student_id          CHAR(36) NOT NULL,
  package_id          CHAR(36),
  branch_id           CHAR(36),
  instructor_id       CHAR(36),
  status              VARCHAR(20) DEFAULT 'active'
                      CHECK (status IN ('pending','active','completed','cancelled','suspended')),
  lessons_completed   INT DEFAULT 0,
  lessons_remaining   INT,
  start_date          DATE,
  end_date            DATE,
  total_paid          DECIMAL(10,2) DEFAULT 0,
  balance_due         DECIMAL(10,2) DEFAULT 0,
  notes               TEXT,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE SET NULL
);

-- ============================================================
-- LESSONS / SCHEDULE
-- ============================================================
CREATE TABLE lessons (
  id                      CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  enrollment_id           CHAR(36),
  student_id              CHAR(36) NOT NULL,
  instructor_id           CHAR(36),
  vehicle_id              CHAR(36),
  branch_id               CHAR(36),
  lesson_type             VARCHAR(30) DEFAULT 'practical'
                          CHECK (lesson_type IN ('practical','theory','yard_test','road_test','observation')),
  scheduled_date          DATE NOT NULL,
  scheduled_time          TIME NOT NULL,
  duration_minutes        INT DEFAULT 60,
  status                  VARCHAR(20) DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled','in_progress','completed','cancelled','no_show')),
  location                TEXT,
  qr_code_token           CHAR(36) DEFAULT (UUID()),
  qr_code_url             TEXT,
  attendance_marked_at    TIMESTAMP,
  attendance_method       VARCHAR(20) DEFAULT 'qr'
                          CHECK (attendance_method IN ('qr','manual','auto')),
  instructor_notes        TEXT,
  student_score           INT CHECK (student_score >= 0 AND student_score <= 100),
  areas_covered           JSON,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE SET NULL,
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (instructor_id) REFERENCES profiles(id) ON DELETE SET NULL,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE payments (
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  student_id        CHAR(36) NOT NULL,
  enrollment_id     CHAR(36),
  branch_id         CHAR(36),
  amount            DECIMAL(10,2) NOT NULL,
  payment_method    VARCHAR(30) CHECK (payment_method IN ('cash','eft','card','online')),
  reference_number  VARCHAR(100),
  status            VARCHAR(20) DEFAULT 'completed'
                    CHECK (status IN ('pending','completed','failed','refunded')),
  description       TEXT,
  receipt_url       TEXT,
  payment_date      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  recorded_by       CHAR(36),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (enrollment_id) REFERENCES enrollments(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE SET NULL
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  message     TEXT NOT NULL,
  type        VARCHAR(30) DEFAULT 'info'
              CHECK (type IN ('info','success','warning','error','lesson','payment','system')),
  is_read     BOOLEAN DEFAULT FALSE,
  action_url  TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- ============================================================
-- AI PREDICTIONS (cached)
-- ============================================================
CREATE TABLE ai_predictions (
  id                CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  student_id        CHAR(36) NOT NULL,
  prediction_type   VARCHAR(30) CHECK (prediction_type IN ('test_readiness','dropout_risk')),
  score             DECIMAL(5,2),
  classification    VARCHAR(30),
  factors           JSON,
  recommendations   JSON,  -- Store as JSON array
  generated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_current        BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- ============================================================
-- CONTACT FORM SUBMISSIONS
-- ============================================================
CREATE TABLE contact_submissions (
  id         CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(100) NOT NULL,
  phone      VARCHAR(20),
  subject    VARCHAR(200),
  message    TEXT NOT NULL,
  branch_id  CHAR(36),
  status     VARCHAR(20) DEFAULT 'new'
             CHECK (status IN ('new','read','responded','closed')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- ============================================================
-- TESTIMONIALS
-- ============================================================
CREATE TABLE testimonials (
  id          CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  student_id  CHAR(36),
  content     TEXT NOT NULL,
  rating      INT CHECK (rating >= 1 AND rating <= 5),
  is_approved BOOLEAN DEFAULT FALSE,
  is_featured BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE SET NULL
);

-- ============================================================
-- SEED DATA — BRANCHES
-- ============================================================
INSERT INTO branches (id, name, address, city, phone, email, google_maps_url, latitude, longitude)
VALUES
  (UUID(), 'Xolani Driving School - Umlazi V',
   'Griffiths Mxenge Highway, Umlazi V', 
   'Durban',
   '+27 79 592 5530', 
   'xolanidrivingschool@gmail.com',
   'https://maps.app.goo.gl/P85gj9g5FwhCgdAn7',
   -29.7489, 31.0664),
  (UUID(), 'Xolani Driving School - Umlazi W',
   'Shop 14, Edamini Centre, Umlazi W', 
   'Durban',
   '+27 73 333 3770', 
   'xolanidrivingschool@gmail.com',
   'https://maps.app.goo.gl/ECA12mgc6AZ8rHgM8',
   -29.8156, 30.8662);

-- ============================================================
-- SEED DATA — PACKAGES
-- ============================================================
INSERT INTO packages (id, name, description, lesson_count, price, validity_days, transmission_type, includes_yard_test, includes_road_test, is_popular, sort_order)
VALUES
  (UUID(), 'Starter Pack',       'Perfect for beginners. Get comfortable behind the wheel.',              5,  1500.00,  60, 'both',      FALSE, FALSE, FALSE, 1),
  (UUID(), 'Standard Pack',      'Our most popular package. Comprehensive training covering all skills.', 10, 2800.00,  90, 'both',      TRUE,  FALSE, TRUE,  2),
  (UUID(), 'Premium Pack',       'Complete driving mastery. Includes yard and road test booking.',        15, 3900.00, 120, 'both',      TRUE,  TRUE,  FALSE, 3),
  (UUID(), 'Manual Specialist',  'Dedicated manual transmission training.',                               12, 3200.00,  90, 'manual',    TRUE,  TRUE,  FALSE, 4),
  (UUID(), 'Auto Express',       'Fast-track automatic transmission course.',                              8, 2400.00,  60, 'automatic', TRUE,  FALSE, FALSE, 5),
  (UUID(), 'Refresher Course',   'Already licensed? Polish your skills with targeted refresher sessions.', 3,  950.00,  30, 'both',      FALSE, FALSE, FALSE, 6);

-- ============================================================
-- SEED DATA — TESTIMONIALS (approved + featured)
-- ============================================================
INSERT INTO testimonials (id, content, rating, is_approved, is_featured)
VALUES
  (UUID(), 'Passed first time! The instructors are incredibly patient and professional. The QR code system for attendance is so cool — no more paper registers.', 5, TRUE, TRUE),
  (UUID(), 'The AI readiness score showed I was 89% ready. Booked my test and passed with flying colours. Best money spent!', 5, TRUE, TRUE),
  (UUID(), 'Friendly staff, very flexible scheduling, and the online portal made it easy to track my progress from my phone. Highly recommended!', 5, TRUE, TRUE),
  (UUID(), 'I was nervous about manual gear, but the instructors built my confidence step by step. Took the standard pack and it was more than enough!', 5, TRUE, TRUE),
  (UUID(), 'The payment plan worked perfectly for my budget. Quality training without breaking the bank.', 4, TRUE, TRUE),
  (UUID(), 'My second child is now also enrolled here. This school delivers results consistently. Family recommendation!', 5, TRUE, TRUE);

-- ============================================================
-- HELPFUL INDEXES
-- ============================================================
CREATE INDEX idx_lessons_student_date ON lessons(student_id, scheduled_date);
CREATE INDEX idx_lessons_scheduled_date ON lessons(scheduled_date);
CREATE INDEX idx_profiles_reset_token ON profiles(reset_token_hash);
CREATE INDEX idx_profiles_verify_token ON profiles(verify_token_hash);
CREATE INDEX idx_payments_student_id ON payments(student_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_enrollments_student ON enrollments(student_id, status);
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_email ON profiles(email);