/**
 * Minimal ambient declarations for the parts of `ical.js` this service uses.
 *
 * The package ships without typings and there is no @types/ical.js on the public
 * registry, so this declares only the surface the iCal mirror relies on. It is
 * intentionally loose (`unknown`/`any` where the full jCal structure is not
 * worth modelling) — `skipLibCheck` keeps the rest of the build quiet.
 */
declare module "ical.js" {
	export function parse(input: string): unknown;

	export class Component {
		constructor(jCal: unknown);
		getAllSubcomponents(name?: string): Component[];
		getFirstSubcomponent(name?: string): Component | null;
		getFirstPropertyValue<T = unknown>(name: string): T;
	}

	export class Time {
		readonly isDate: boolean;
		toJSDate(): Date;
		toUnixTime(): number;
		compare(other: Time): number;
	}

	export interface OccurrenceDetails {
		uid: string;
		startDate: Time;
		endDate: Time;
	}

	export class Event {
		constructor(component: Component);
		readonly uid: string;
		readonly summary: string;
		readonly startDate: Time;
		readonly endDate: Time;
		isRecurring(): boolean;
		iterator(startTime?: Time): { next(): Time | null };
		getOccurrenceDetails(occurrence: Time): OccurrenceDetails;
	}
}
