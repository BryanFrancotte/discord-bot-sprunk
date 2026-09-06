'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const commands = require('../src/commands');
const TicketService = require('../src/services/TicketService');

test('les commandes slash sont sérialisables et ont des noms uniques', () => {
    const serialized = commands.map(command => command.data.toJSON());
    const names = serialized.map(command => command.name);

    assert.deepEqual(names.sort(), ['acquire', 'distributeur', 'mission', 'template', 'troll']);
    assert.equal(new Set(names).size, names.length);
});

test('les métadonnées d’un ticket peuvent être relues depuis son topic', () => {
    const service = new TicketService({}, {}, {});
    const topic = service.buildTopic('123456789012345678', 'support-rh');

    assert.deepEqual(service.parseTopic(topic), {
        ownerId: '123456789012345678',
        categoryId: 'support-rh'
    });
    assert.equal(service.parseTopic('topic ordinaire'), null);
});

test('la categorie architecture declenche le questionnaire dedie', () => {
    const service = new TicketService({}, {}, {});

    assert.equal(service.needsArchitectureQuestionnaire({ id: 'architecture' }), true);
    assert.equal(service.needsArchitectureQuestionnaire({ id: 'Architecture' }), true);
    assert.equal(service.needsArchitectureQuestionnaire({ id: 'support' }), false);
});

test('la previsualisation du transcript reste compatible avec Discord', () => {
    const service = new TicketService({}, {}, {});
    const preview = service.buildTranscriptPreview('TRANSCRIPT SPRUNK\n'.repeat(200));

    assert.equal(preview.startsWith('```txt\n'), true);
    assert.equal(preview.endsWith('\n```'), true);
    assert.equal(preview.length <= 2000, true);
});

test('la construction du transcript liste les messages avec horodatage et pieces jointes', () => {
    const service = new TicketService({}, {}, {});
    const channel = { name: 'ticket-support-1' };
    const messages = [
        {
            createdAt: new Date('2027-01-15T20:00:00.000Z'),
            author: { tag: 'user#0001' },
            content: 'Bonjour',
            attachments: new Map()
        },
        {
            createdAt: new Date('2027-01-15T20:01:00.000Z'),
            author: { tag: 'staff#0002' },
            content: '',
            attachments: new Map([['1', { url: 'https://example.com/a.png' }]])
        }
    ];

    const transcript = service.buildTranscript(channel, messages);

    assert.match(transcript, /^TRANSCRIPT SPRUNK - #ticket-support-1/);
    assert.match(transcript, /user#0001: Bonjour/);
    assert.match(transcript, /staff#0002: \[message sans texte\] https:\/\/example\.com\/a\.png/);
});

test('les permissions du ticket accordent acces au proprietaire, au staff et au bot', () => {
    const client = { user: { id: 'bot-1' } };
    const service = new TicketService(client, {}, {});
    const interaction = {
        guild: { id: 'guild-1' },
        user: { id: 'user-1' }
    };
    const ticketConfig = { staffRoleId: 'role-1' };

    const overwrites = service.buildTicketPermissionOverwrites(interaction, ticketConfig);

    assert.deepEqual(overwrites.map(overwrite => overwrite.id), ['guild-1', 'user-1', 'role-1', 'bot-1']);
    assert.ok(overwrites[0].deny.length > 0);
    assert.ok(overwrites[3].allow.length > overwrites[1].allow.length);
});

test('les permissions du ticket peuvent cibler un proprietaire different de l auteur de l interaction', () => {
    const client = { user: { id: 'bot-1' } };
    const service = new TicketService(client, {}, {});
    const interaction = {
        guild: { id: 'guild-1' },
        user: { id: 'staff-1' }
    };
    const ticketConfig = { staffRoleId: 'role-1' };

    const overwrites = service.buildTicketPermissionOverwrites(interaction, ticketConfig, 'owner-9');

    assert.deepEqual(overwrites.map(overwrite => overwrite.id), ['guild-1', 'owner-9', 'role-1', 'bot-1']);
});

test('le menu d acquisition encode le proprietaire choisi dans le customId', async () => {
    const client = { config: { tickets: [{ id: 'support', label: 'Support', emoji: '🎫' }] } };
    const service = new TicketService(client, {}, {});
    let sentPayload = null;
    const interaction = {
        editReply: async payload => { sentPayload = payload; }
    };

    await service.showAcquireCategoryMenu(interaction, '123456789012345678');

    const menu = sentPayload.components[0].components[0].toJSON();
    assert.equal(menu.custom_id, 'ticket:acquire-confirm:123456789012345678');
    assert.deepEqual(menu.options.map(option => option.value), ['support']);
    assert.match(sentPayload.content, /123456789012345678/);
});

test('la rangee de controles expose les cinq actions du ticket', () => {
    const service = new TicketService({}, {}, {});
    const row = service.buildTicketControlsRow();
    const customIds = row.toJSON().components.map(button => button.custom_id);

    assert.deepEqual(customIds, [
        'ticket:close',
        'ticket:reassign',
        'ticket:rename',
        'ticket:add-user',
        'ticket:remove-user'
    ]);
});
