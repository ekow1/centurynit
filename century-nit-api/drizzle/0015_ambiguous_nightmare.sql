ALTER TABLE "tickets" ADD COLUMN "source" varchar(16) DEFAULT 'external' NOT NULL;--> statement-breakpoint
CREATE INDEX "tickets_source_idx" ON "tickets" USING btree ("source","status");