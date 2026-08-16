/**
 * Domain surface shared by century-nit-web (public site + applicant portal) and
 * century-nit-ops (Operations Center).
 *
 * These two apps build and deploy separately but run on the same origin, and
 * they talk to each other through `localStorage`. That makes three things
 * genuinely common property rather than either app's to own:
 *
 *  - the seed catalogue and pricing constants (`content`)
 *  - the storage KEYS and record shapes both sides read and write
 *    (`content`, `opsTypes`, `siteContent`)
 *  - the guarded storage helpers that every write goes through (`storage`)
 *
 * If a symbol is only ever used by one app, it does not belong here.
 */

export * from "./content.js";
export * from "./availability.js";
export * from "./storage.js";
export * from "./fileStore.js";
export * from "./siteContent.js";
export { meApi } from "./api.js";

/**
 * The ops record types live behind `century-nit-core/ops` rather than being
 * flattened in here, because two of their names collide with the portal's on
 * purpose: `PaymentPlanId` and `ServicePackage` describe the same real-world
 * thing from the two sides of the business and do not have the same shape.
 * Flattening them would have forced a rename that hides a divergence worth
 * seeing. Import ops vocabulary explicitly:
 *
 *     import type { MockConsultation } from "century-nit-core/ops";
 */
