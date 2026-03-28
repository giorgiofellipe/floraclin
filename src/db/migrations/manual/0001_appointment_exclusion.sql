-- Appointment exclusion constraint: prevent double-booking at the DB level.
-- Requires the btree_gist extension (available on Supabase by default).
-- Run this AFTER the main Drizzle migration.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE floraclin.appointments
  ADD CONSTRAINT no_overlapping_appointments
  EXCLUDE USING gist (
    practitioner_id WITH =,
    date WITH =,
    tsrange(
      (date + start_time)::timestamp,
      (date + end_time)::timestamp
    ) WITH &&
  )
  WHERE (deleted_at IS NULL AND status NOT IN ('cancelled'));
