import { z } from "zod";

export const schoolTrackStatusSchema = z.enum([
	"Draft",
	"Preparing Application",
	"Documents under review",
	"Submitted to University",
	"Conditional Offer Received",
	"Unconditional Offer",
	"Offer Accepted",
	"Offer Declined",
	"Application Rejected",
	"Waitlisted",
	"Withdrawn",
]);
export type SchoolTrackStatus = z.infer<typeof schoolTrackStatusSchema>;

export const schoolTrackEventSchema = z.object({
	id: z.string().uuid().optional(),
	at: z.string().datetime(),
	status: schoolTrackStatusSchema,
	note: z.string().default(""),
	financialNote: z.string().nullable().optional(),
});
export type SchoolTrackEvent = z.infer<typeof schoolTrackEventSchema>;

export const addSchoolApplicationSchema = z.object({
	destinationId: z.string().min(1).max(64),
	universityId: z.string().min(1).max(128),
	programId: z.string().min(1).max(128),
	intake: z.string().min(1).max(64),
});
export type AddSchoolApplication = z.infer<typeof addSchoolApplicationSchema>;

export const opsAddSchoolApplicationSchema = addSchoolApplicationSchema.extend({
	applicantId: z.string().uuid(),
});
export type OpsAddSchoolApplication = z.infer<typeof opsAddSchoolApplicationSchema>;

export const schoolApplicationSchema = z.object({
	id: z.string().uuid(),
	applicantId: z.string().uuid(),
	applicationId: z.string().uuid().nullable().optional(),
	destinationId: z.string(),
	universityId: z.string(),
	programId: z.string(),
	intake: z.string(),
	status: schoolTrackStatusSchema,
	handlerNote: z.string().nullable(),
	financialNote: z.string().nullable(),
	events: z.array(schoolTrackEventSchema),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});
export type SchoolApplication = z.infer<typeof schoolApplicationSchema>;

export const schoolApplicationListSchema = z.object({
	schools: z.array(schoolApplicationSchema),
	total: z.number().int(),
	selectionDoneAt: z.string().datetime().nullable().optional(),
	invoiceId: z.string().uuid().nullable().optional(),
});
export type SchoolApplicationList = z.infer<typeof schoolApplicationListSchema>;

export const updateSchoolStatusSchema = z.object({
	status: schoolTrackStatusSchema,
	handlerNote: z.string().max(2000).optional(),
	financialNote: z.string().max(2000).optional(),
	note: z.string().max(2000).optional(),
});
export type UpdateSchoolStatus = z.infer<typeof updateSchoolStatusSchema>;

export const lockSchoolsSchema = z.object({
	note: z.string().max(1000).optional(),
});
export type LockSchools = z.infer<typeof lockSchoolsSchema>;

export const studentScholarshipSchema = z.object({
	id: z.string().uuid(),
	applicantId: z.string().uuid(),
	scholarshipId: z.string(),
	awardedAt: z.string().datetime(),
	notes: z.string().nullable().optional(),
});
export type StudentScholarship = z.infer<typeof studentScholarshipSchema>;

export const assignScholarshipSchema = z.object({
	scholarshipId: z.string().min(1),
	notes: z.string().optional(),
});
export type AssignScholarship = z.infer<typeof assignScholarshipSchema>;
