import { z } from "zod";

export const userSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	emailVerified: z.boolean().default(false),
	name: z.string().nullable().optional(),
	image: z.string().nullable().optional(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const signUpSchema = z.object({
	email: z.string().email(),
	password: z.string().min(12),
	name: z.string().min(1),
});

export const signInSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1),
});

export type User = z.infer<typeof userSchema>;
export type SignUp = z.infer<typeof signUpSchema>;
export type SignIn = z.infer<typeof signInSchema>;
