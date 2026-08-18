CREATE TABLE "student_scholarships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"applicant_id" uuid NOT NULL,
	"scholarship_id" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now(),
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "student_scholarships" ADD CONSTRAINT "student_scholarships_applicant_id_applicants_id_fk" FOREIGN KEY ("applicant_id") REFERENCES "public"."applicants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_scholarships" ADD CONSTRAINT "student_scholarships_scholarship_id_catalog_scholarships_id_fk" FOREIGN KEY ("scholarship_id") REFERENCES "public"."catalog_scholarships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_scholarships_applicant_idx" ON "student_scholarships" USING btree ("applicant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_scholarships_unique_idx" ON "student_scholarships" USING btree ("applicant_id","scholarship_id");