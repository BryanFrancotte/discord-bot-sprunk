'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const SprunkClient = require('../src/core/SprunkClient');

test('le client initialise tous ses services sans connexion Discord', async context => {
    const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sprunk-client-test-'));
    const configService = {
        current: {
            bot: {
                guildId: '123456789012345678',
                color: '#2ecc71',
                footerText: 'Test',
                reassignRoleId: '123456789012345679'
            },
            tickets: [{
                id: 'support',
                label: 'Support',
                title: 'Support',
                description: 'Bonjour {user}',
                staffRoleId: '123456789012345680'
            }]
        },
        watch() {},
        close() {}
    };
    const client = new SprunkClient({ configService, token: 'test-token', dataDirectory });

    context.after(async () => {
        client.destroy();
        await fs.rm(dataDirectory, { recursive: true, force: true });
    });

    await client.initialize();

    assert.equal(client.commands.size, 4);
    assert.ok(client.services.tickets);
    assert.ok(client.services.missions);
    assert.ok(client.services.reminders);
    assert.ok(client.services.ticketLogs);
    assert.ok(client.services.troll);
});
