-- Fix the employee-overlap exclusion constraint so cancelled bookings release
-- their slot.
--
-- 0001 created it as `WHERE (employee_id IS NOT NULL)`, which keeps a CANCELLED
-- or NO_SHOW booking blocking its employee's time forever. That breaks the last
-- step of the required end-to-end scenario — "booking becomes CANCELLED … slot
-- becomes available again" — for the assigned employee, while the branch-level
-- partial unique index (which does exclude those statuses) frees up correctly.
-- The two guards disagreeing is worse than either being absent: the slot looks
-- bookable but assigning anyone to it fails.
--
-- Written as DROP IF EXISTS + ADD so it is safe on a database that already has
-- 0001 applied and on a fresh one.

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_employee_overlap_excl";--> statement-breakpoint

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_employee_overlap_excl" EXCLUDE USING gist (
	employee_id WITH =,
	tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (
	employee_id IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW')
);
