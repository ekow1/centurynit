-- Payment Execution is no longer a stage a case sits in. The service fee's
-- pre-departure milestone is paid inside Departure, before the ticket is
-- issued; the post-arrival remainder is aftercare. Cases parked at
-- payment_execution move back to travel_assistance (the same chapter), and
-- the finance handoffs that stage used to queue are withdrawn.
UPDATE "applications" SET "stage" = 'travel_assistance', "updated_at" = now() WHERE "stage" = 'payment_execution';
UPDATE "stage_handoffs" SET "status" = 'cancelled', "updated_at" = now() WHERE "stage" = 'payment_execution' AND "status" = 'pending';
