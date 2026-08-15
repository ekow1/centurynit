import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Behavioural test for the slot-conflict fix.
 *
 * Runs the real compiled module from ../dist against a fake localStorage, so it
 * exercises exactly the code both apps import.
 *
 * Run with `npm test` from the repo root (builds packages first). No test
 * framework on purpose — this is the repo's first test and a plain node script
 * adds no dependencies.
 */

const store = new Map();
globalThis.localStorage = {
	getItem: (k) => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => store.set(k, String(v)),
	removeItem: (k) => store.delete(k),
	clear: () => store.clear(),
};

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(here, '..', 'dist', 'availability.js')).href);
const { isSlotBooked, bookedTimesOn, upcomingDays, resolveBranchId, slotFromToday, toDateKey } = mod;

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
	if (cond) { pass++; console.log(`  PASS  ${name}`); }
	else { fail++; console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}

const dayAfter = (n) => {
	const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
	return toDateKey(d);
};

console.log('\n1. branch-id reconciliation (ops "accra" vs catalogue "accra-hq")');
check('resolveBranchId("accra") -> accra-hq', resolveBranchId('accra') === 'accra-hq', String(resolveBranchId('accra')));
check('resolveBranchId("kumasi") -> kumasi', resolveBranchId('kumasi') === 'kumasi');
check('unknown branch -> null', resolveBranchId('atlantis') === null);

console.log('\n2. THE BUG: a booked ops consultation must occupy its slot');
store.clear();
const D = dayAfter(6);                       // outside the seeded texture
check('slot free before anyone books', isSlotBooked('accra-hq', D, '11:00') === false);

store.set('century-nit-ops-state', JSON.stringify({
	consultations: [{ slotBranchId: 'accra-hq', slotDate: D, slotTime: '11:00', status: 'Assigned' }],
}));
check('slot TAKEN once an ops consultation holds it', isSlotBooked('accra-hq', D, '11:00') === true);
check('a different time stays free', isSlotBooked('accra-hq', D, '14:00') === false);
check('same time at another branch stays free', isSlotBooked('kumasi', D, '11:00') === false);

console.log('\n3. the portal applicant\'s own booking also occupies a slot');
store.clear();
const P = dayAfter(7);
store.set('century-nit-booking', JSON.stringify({
	branchId: 'kumasi', date: P, time: '15:00', paymentStatus: 'idle', confirmationId: null,
}));
check('a DRAFT selection does not hold the slot', isSlotBooked('kumasi', P, '15:00') === false);

store.set('century-nit-booking', JSON.stringify({
	branchId: 'kumasi', date: P, time: '15:00', paymentStatus: 'success', confirmationId: 'CNS-9',
}));
check('a PAID booking holds the slot', isSlotBooked('kumasi', P, '15:00') === true);

console.log('\n4. cancelled consultations release their slot');
store.clear();
const C = dayAfter(8);
store.set('century-nit-ops-state', JSON.stringify({
	consultations: [{ slotBranchId: 'lagos', slotDate: C, slotTime: '09:00', status: 'Cancelled' }],
}));
check('cancelled -> slot free again', isSlotBooked('lagos', C, '09:00') === false);

console.log('\n5. records with only a display string are ignored, not guessed at');
store.clear();
store.set('century-nit-ops-state', JSON.stringify({
	consultations: [{ dateTime: 'Today, 10:00 AM', status: 'Assigned' }],   // legacy shape
}));
check('legacy record does not crash or falsely occupy', isSlotBooked('accra-hq', dayAfter(9), '10:00') === false);

console.log('\n6. bookedTimesOn returns exactly the taken times');
store.clear();
const M = dayAfter(10);
store.set('century-nit-ops-state', JSON.stringify({
	consultations: [
		{ slotBranchId: 'accra-hq', slotDate: M, slotTime: '09:00', status: 'Assigned' },
		{ slotBranchId: 'accra-hq', slotDate: M, slotTime: '13:00', status: 'Under Review' },
		{ slotBranchId: 'kumasi', slotDate: M, slotTime: '10:00', status: 'Assigned' },
	],
}));
const times = bookedTimesOn('accra-hq', M);
check('two times taken at accra-hq', times.size === 2 && times.has('09:00') && times.has('13:00'),
	[...times].join(','));
check('other branch not leaked in', !times.has('10:00'));

console.log('\n7. calendar rules');
store.clear();
const days = upcomingDays('accra-hq', 21);
check('never offers today', !days.some((d) => d.date === toDateKey(new Date())));
check('offers 21 days', days.length === 21);
check('every Sunday disabled', days.filter((d) => new Date(d.date + 'T00:00').getDay() === 0).every((d) => d.disabled));
check('accra-hq closed at weekends (Sat disabled)',
	days.filter((d) => new Date(d.date + 'T00:00').getDay() === 6).every((d) => d.disabled));
check('at least one weekday open', days.some((d) => !d.disabled));

console.log('\n8. seeded demo texture is relative, so it can never expire');
store.clear();
const seeded = slotFromToday('accra', 1, '10:00');
check('slot date is in the future', seeded.slotDate > toDateKey(new Date()));
check('branch resolved to catalogue id', seeded.slotBranchId === 'accra-hq');
check('display string derived, not hand-written', /\d/.test(seeded.dateTime) && seeded.dateTime.includes('·'));

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
