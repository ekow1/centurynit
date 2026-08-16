import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
	AVATAR_ERROR_CODES,
	avatarUrlSchema,
	avatarUploadTicketSchema,
	completeAvatarUploadSchema,
	requestAvatarUploadSchema,
} from "century-nit-shared";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { HttpError } from "../middleware/error.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";
import { getDocumentStorage } from "../services/storage/index.js";

/**
 * Applicant profile pictures.
 *
 * One image per account, stored in the same private bucket as documents and
 * served the same way: a fresh, expiring signed URL. The file itself never
 * passes through Node. Unlike documents there is no database row — the storage
 * key is the user's `image` column, so the flow is ticket → PUT → complete,
 * where complete verifies the object actually landed before committing the key.
 *
 * `users.image` is also where Better Auth puts a Google sign-in avatar (an
 * ordinary public URL). Reading a URL that is already `http(s)://` returns it
 * as-is; only keys are signed. Uploading a photo replaces whatever was there,
 * which is the point of the button.
 */

const avatarRouter = new OpenAPIHono<{ Variables: AuthVariables }>();

/** Storage keys live in `${userId}/avatar/` — nothing else may be claimed. */
function isOwnAvatarKey(userId: string, key: string): boolean {
	const prefix = `${userId}/avatar/`;
	return key.startsWith(prefix) && key.length > prefix.length && !key.includes("..");
}

function extensionFor(contentType: string): string {
	return contentType === "image/png" ? "png" : "jpg";
}

async function storageOrThrow() {
	const storage = await getDocumentStorage();
	if (!storage.enabled) {
		throw new HttpError(
			503,
			AVATAR_ERROR_CODES.STORAGE_NOT_CONFIGURED,
			"Profile pictures are not available yet. Please try again later.",
		);
	}
	return storage;
}

/* ── GET /api/v1/me/avatar ─────────────────────────────────────────────────── */

avatarRouter.openapi(
	createRoute({
		method: "get",
		path: "/avatar",
		tags: ["Applicants"],
		summary: "Get a signed URL for the signed-in user's profile picture",
		middleware: [requireAuth] as const,
		responses: {
			200: {
				content: { "application/json": { schema: avatarUrlSchema } },
				description: "A fresh, short-lived signed URL, or null when no photo is set",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");

		const [row] = await db
			.select({ image: users.image })
			.from(users)
			.where(eq(users.id, user.id))
			.limit(1);

		const image = row?.image ?? null;
		if (!image) return c.json({ url: null, expiresAt: null });

		// A provider URL (e.g. Google's avatar) is already public and permanent.
		if (/^https?:\/\//i.test(image)) {
			return c.json({ url: image, expiresAt: null });
		}

		const storage = await storageOrThrow();
		const ticket = await storage.createDownloadUrl({ key: image });
		return c.json({ url: ticket.url, expiresAt: ticket.expiresAt.toISOString() });
	},
);

/* ── POST /api/v1/me/avatar/upload-url ─────────────────────────────────────── */

avatarRouter.openapi(
	createRoute({
		method: "post",
		path: "/avatar/upload-url",
		tags: ["Applicants"],
		summary: "Request a signed URL to upload a profile picture",
		description:
			"Returns a short-lived upload URL and the storage key to hand back on /complete.",
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: requestAvatarUploadSchema } },
				required: true,
			},
		},
		responses: {
			201: {
				content: { "application/json": { schema: avatarUploadTicketSchema } },
				description: "Upload ticket",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const storage = await storageOrThrow();

		const storageKey = `${user.id}/avatar/${randomUUID()}.${extensionFor(body.contentType)}`;

		const ticket = await storage.createUploadUrl({
			key: storageKey,
			contentType: body.contentType,
		});

		return c.json(
			{
				key: storageKey,
				uploadUrl: ticket.url,
				headers: ticket.headers,
				expiresAt: ticket.expiresAt.toISOString(),
			},
			201,
		);
	},
);

/* ── POST /api/v1/me/avatar/complete ───────────────────────────────────────── */

avatarRouter.openapi(
	createRoute({
		method: "post",
		path: "/avatar/complete",
		tags: ["Applicants"],
		summary: "Confirm an avatar upload finished and make it the profile picture",
		description:
			"Verifies the object exists in storage under the key the ticket returned, then " +
			"commits it as the user's photo and removes the previous one.",
		middleware: [requireAuth] as const,
		request: {
			body: {
				content: { "application/json": { schema: completeAvatarUploadSchema } },
				required: true,
			},
		},
		responses: {
			200: {
				content: { "application/json": { schema: avatarUrlSchema } },
				description: "A fresh signed URL for the new photo",
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		const body = c.req.valid("json");
		const storage = await storageOrThrow();

		// The key is the one thing the client names, so it is constrained hard:
		// this user's own avatar folder, no traversal. Whatever else it might be,
		// it must already exist in storage — a key is only a claim on an object.
		if (!isOwnAvatarKey(user.id, body.key)) {
			throw new HttpError(403, AVATAR_ERROR_CODES.INVALID_KEY, "That key is not allowed");
		}

		const object = await storage.head(body.key);
		if (!object) {
			throw new HttpError(
				409,
				AVATAR_ERROR_CODES.UPLOAD_NOT_COMPLETED,
				"The photo has not finished uploading",
			);
		}

		const [row] = await db
			.select({ image: users.image })
			.from(users)
			.where(eq(users.id, user.id))
			.limit(1);
		const previous = row?.image ?? null;

		await db
			.update(users)
			.set({ image: body.key, updatedAt: new Date() })
			.where(eq(users.id, user.id));

		// Clear the superseded photo — the provider URL or a previous avatar
		// object — but never the one just committed.
		if (previous && previous !== body.key && !/^https?:\/\//i.test(previous)) {
			await storage.remove(previous).catch(() => {
				/* orphaned object; not worth failing the upload the user just made */
			});
		}

		const ticket = await storage.createDownloadUrl({ key: body.key });
		return c.json({ url: ticket.url, expiresAt: ticket.expiresAt.toISOString() });
	},
);

export { avatarRouter };
