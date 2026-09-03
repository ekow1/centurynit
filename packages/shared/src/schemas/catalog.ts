import { z } from "zod";

export const CatalogDestinationSchema = z.object({
	id: z.string(),
	name: z.string(),
	region: z.string(),
	tagline: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	highlights: z.array(z.string()).nullable().optional(),
	universities: z.number().nullable().optional(),
	programs: z.number().nullable().optional(),
	image: z.string().nullable().optional(),
	flag: z.string().nullable().optional(),
	isActive: z.boolean().nullable().optional(),
	createdAt: z.string().nullable().optional(),
	updatedAt: z.string().nullable().optional(),
});
export type CatalogDestination = z.infer<typeof CatalogDestinationSchema>;
export const CatalogDestinationCreateSchema = CatalogDestinationSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
export type CatalogDestinationCreate = z.infer<typeof CatalogDestinationCreateSchema>;
export const CatalogDestinationUpdateSchema = CatalogDestinationSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial();
export type CatalogDestinationUpdate = z.infer<typeof CatalogDestinationUpdateSchema>;

export const CatalogUniversitySchema = z.object({
	id: z.string(),
	name: z.string(),
	destinationId: z.string().nullable().optional(),
	city: z.string().nullable().optional(),
	ranking: z.string().nullable().optional(),
	type: z.string().nullable().optional(),
	acceptance: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	image: z.string().nullable().optional(),
	tags: z.array(z.string()).nullable().optional(),
	isActive: z.boolean().nullable().optional(),
	createdAt: z.string().nullable().optional(),
	updatedAt: z.string().nullable().optional(),
});
export type CatalogUniversity = z.infer<typeof CatalogUniversitySchema>;
export const CatalogUniversityCreateSchema = CatalogUniversitySchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
export type CatalogUniversityCreate = z.infer<typeof CatalogUniversityCreateSchema>;
export const CatalogUniversityUpdateSchema = CatalogUniversitySchema.omit({ id: true, createdAt: true, updatedAt: true }).partial();
export type CatalogUniversityUpdate = z.infer<typeof CatalogUniversityUpdateSchema>;

export const CatalogProgramSchema = z.object({
	id: z.string(),
	name: z.string(),
	universityId: z.string().nullable().optional(),
	level: z.string().nullable().optional(),
	field: z.string().nullable().optional(),
	duration: z.string().nullable().optional(),
	tuition: z.string().nullable().optional(),
	tuitionUsd: z.number().nullable().optional(),
	intake: z.array(z.string()).nullable().optional(),
	applicationDeadline: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	isActive: z.boolean().nullable().optional(),
	createdAt: z.string().nullable().optional(),
	updatedAt: z.string().nullable().optional(),
});
export type CatalogProgram = z.infer<typeof CatalogProgramSchema>;
export const CatalogProgramCreateSchema = CatalogProgramSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
export type CatalogProgramCreate = z.infer<typeof CatalogProgramCreateSchema>;
export const CatalogProgramUpdateSchema = CatalogProgramSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial();
export type CatalogProgramUpdate = z.infer<typeof CatalogProgramUpdateSchema>;

export const CatalogScholarshipSchema = z.object({
	id: z.string(),
	name: z.string(),
	universityId: z.string().nullable().optional(),
	amount: z.string().nullable().optional(),
	type: z.string().nullable().optional(),
	deadline: z.string().nullable().optional(),
	eligibility: z.string().nullable().optional(),
	isActive: z.boolean().nullable().optional(),
	createdAt: z.string().nullable().optional(),
	updatedAt: z.string().nullable().optional(),
});
export type CatalogScholarship = z.infer<typeof CatalogScholarshipSchema>;
export const CatalogScholarshipCreateSchema = CatalogScholarshipSchema.omit({ createdAt: true, updatedAt: true }).partial({ id: true });
export type CatalogScholarshipCreate = z.infer<typeof CatalogScholarshipCreateSchema>;
export const CatalogScholarshipUpdateSchema = CatalogScholarshipSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial();
export type CatalogScholarshipUpdate = z.infer<typeof CatalogScholarshipUpdateSchema>;
