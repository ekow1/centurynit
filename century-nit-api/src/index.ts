import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { env } from "./env.js";

const app = createApp();

serve({
	fetch: app.fetch,
	port: Number(env.PORT),
});

console.log(`Century NIT API running on http://localhost:${env.PORT}`);
