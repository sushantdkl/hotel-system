CREATE TABLE IF NOT EXISTS review_forms (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL UNIQUE,
  thank_you_message TEXT NOT NULL DEFAULT 'Thank you for sharing your feedback.',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS review_questions (
  id SERIAL PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES review_forms(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',
  is_required INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_reviews (
  id SERIAL PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES review_forms(id) ON DELETE RESTRICT,
  customer_name TEXT,
  customer_phone TEXT,
  source TEXT NOT NULL DEFAULT 'customer',
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS review_answers (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES customer_reviews(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES review_questions(id) ON DELETE RESTRICT,
  answer TEXT NOT NULL,
  UNIQUE(review_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_review_questions_form ON review_questions(form_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_customer_reviews_form_status ON customer_reviews(form_id, status, created_at);
