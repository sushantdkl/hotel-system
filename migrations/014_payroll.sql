-- 014: payroll inside employee management.
-- Employees (users) gain a monthly salary, a hire date and a job title, and
-- salary_payments records each payout so an employee has a payment history.
ALTER TABLE users ADD COLUMN IF NOT EXISTS salary DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS position TEXT;

CREATE TABLE IF NOT EXISTS salary_payments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL CHECK (amount >= 0),
  period_label TEXT,
  paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
  method TEXT DEFAULT 'cash',
  note TEXT,
  paid_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_salary_payments_employee ON salary_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_paid_on ON salary_payments(paid_on DESC);
