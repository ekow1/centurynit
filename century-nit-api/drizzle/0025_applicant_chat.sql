ALTER TYPE "conversation_type" ADD VALUE 'applicant';
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "user_id" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_user_id" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "sender_ops_user_id" DROP NOT NULL;
