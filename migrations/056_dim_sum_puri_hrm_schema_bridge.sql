-- Bridge the production Dim Sum Puri `hr_*` HRM schema to the newer
-- unprefixed HRM schema. Legacy tables remain in place for audit/rollback;
-- records are copied with the same ids so existing user assignments survive.

DO $$
BEGIN
  IF to_regclass('public.hr_departments') IS NOT NULL THEN
    INSERT INTO departments (id, name, description, is_active, created_at, updated_at)
    SELECT id, name, description, is_active, created_at, updated_at
    FROM hr_departments
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_active = EXCLUDED.is_active,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF to_regclass('public.hr_designations') IS NOT NULL THEN
    INSERT INTO designations (id, name, department_id, description, is_active, created_at, updated_at)
    SELECT id, name, department_id, description, is_active, created_at, updated_at
    FROM hr_designations
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      department_id = EXCLUDED.department_id,
      description = EXCLUDED.description,
      is_active = EXCLUDED.is_active,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF to_regclass('public.hr_attendance') IS NOT NULL THEN
    INSERT INTO attendance (user_id, business_date, status, note, marked_by, created_at, updated_at)
    SELECT employee_id, attendance_date::text, status, notes, marked_by, created_at, updated_at
    FROM hr_attendance
    ON CONFLICT (user_id, business_date) DO UPDATE SET
      status = EXCLUDED.status,
      note = EXCLUDED.note,
      marked_by = EXCLUDED.marked_by,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF to_regclass('public.hr_holidays') IS NOT NULL THEN
    INSERT INTO holidays (holiday_date, name, note, created_by, created_at)
    SELECT holiday_date::text, name, description, created_by, created_at
    FROM hr_holidays
    ON CONFLICT (holiday_date) DO UPDATE SET
      name = EXCLUDED.name,
      note = EXCLUDED.note;
  END IF;
END $$;

-- The production lineage attached these columns to hr_departments and
-- hr_designations. The ids above are preserved, so changing the FK target does
-- not rewrite or invalidate any user row.
DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
     AND ccu.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'users'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name IN ('hr_departments', 'hr_designations')
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_row.constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema
     AND kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
     AND ccu.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'users'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'department_id'
      AND ccu.table_name = 'departments'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_department_id_dim_sum_puri_fkey
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_schema = tc.constraint_schema
     AND kcu.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_schema = tc.constraint_schema
     AND ccu.constraint_name = tc.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'users'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'designation_id'
      AND ccu.table_name = 'designations'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_designation_id_dim_sum_puri_fkey
      FOREIGN KEY (designation_id) REFERENCES designations(id) ON DELETE SET NULL;
  END IF;
END $$;

SELECT setval(
  pg_get_serial_sequence('departments', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM departments), 1), 1),
  EXISTS (SELECT 1 FROM departments)
);
SELECT setval(
  pg_get_serial_sequence('designations', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM designations), 1), 1),
  EXISTS (SELECT 1 FROM designations)
);
