import type { MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";

export const requestId: MiddlewareHandler<{ Variables: { requestId: string } }> = async (c, next) => {
	const requestId = c.req.header("x-request-id") ?? randomUUID();
	c.set("requestId", requestId);
	c.header("x-request-id", requestId);
	await next();
};
