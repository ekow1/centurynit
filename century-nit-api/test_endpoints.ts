import { db } from './src/db/index.js';
import { opsUsers } from './src/db/schema.js';
import { getStaffDirectoryDetailed, heartbeat } from './src/services/communication.js';
import { listConversations } from './src/services/chat.js';

async function test() {
    console.log('Testing staff query...');
    const staffList = await db.select().from(opsUsers);
    console.log(`Found ${staffList.length} staff members:`, staffList.map(s => ({ id: s.id, name: s.name, role: s.role })));

    if (staffList.length > 0) {
        const firstStaff = staffList[0];
        console.log(`\nTesting heartbeat for ${firstStaff.name} (${firstStaff.id})...`);
        await heartbeat(firstStaff.id);
        console.log('Heartbeat OK!');

        console.log(`\nTesting listConversations for ${firstStaff.name}...`);
        const convs = await listConversations(firstStaff.id);
        console.log('listConversations OK!', convs);

        console.log('\nTesting getStaffDirectoryDetailed...');
        const dir = await getStaffDirectoryDetailed();
        console.log('getStaffDirectoryDetailed OK!', dir);
    }
    process.exit(0);
}

test().catch(err => {
    console.error('TEST FAILED WITH ERROR:', err);
    process.exit(1);
});
