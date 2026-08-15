import { S3Client } from "@aws-sdk/client-s3";
import { env } from "../env.js";

export const r2 = env.R2_ENDPOINT
	? new S3Client({
			region: "auto",
			endpoint: env.R2_ENDPOINT,
			credentials: {
				accessKeyId: env.R2_ACCESS_KEY_ID || "",
				secretAccessKey: env.R2_SECRET_ACCESS_KEY || "",
			},
		})
	: null;

export const R2_BUCKET = env.R2_BUCKET;
