-- 042: employee salary advances and advance deductions during payroll.

CREATE TABLE IF NOT EXISTS salary_advances (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES users(id),
  amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  advanced_on DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  given_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  business_day_id INTEGER REFERENCES business_days(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS gross_amount DOUBLE PRECISION;
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS advance_deduction DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_salary_advances_employee_date
  ON salary_advances(employee_id, advanced_on DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_salary_advances_business_day
  ON salary_advances(business_day_id);
