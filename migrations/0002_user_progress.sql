-- User progress table (stores course progress per email)
CREATE TABLE IF NOT EXISTS user_progress (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  course_slug TEXT NOT NULL,
  completed_lessons TEXT DEFAULT '[]',  -- JSON array of lesson IDs
  completed_modules TEXT DEFAULT '[]',  -- JSON array of module slugs
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email, course_slug)
);
CREATE INDEX IF NOT EXISTS idx_user_progress_email ON user_progress(email);
