'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TicketService = require('../src/services/TicketService');
const {
    findTicketConfigByChannelCategory,
    findTicketControlsMessage,
    isTicketControlsMessage
} = require('../src/utils/ticketMessages');

const TICKETS = [
    { id: 'direction', label: 'Direction', categoryId: '111111111111111111', staffRoleId: '999999999999999999', title: 'Direction', description: 'Bonjour {user}' },
    { id: 'architecture', label: 'Architecture', categoryId: '222222222222222222', staffRoleId: '888888888888888888', title: 'Architecture', description: 'Bonjour {user}' }
];

function buildControlsMessage(botId, createdTimestamp) {
    return {
        author: { id: botId },
        createdTimestamp,
        components: [{ components: [{ customId: 'ticket:close' }, { customId: 'ticket:rename' }] }]
    };
}

test('la categorie du ticket se deduit de la categorie Discord du salon', () => {
    assert.equal(findTicketConfigByChannelCategory(TICKETS, '222222222222222222').id, 'architecture');
    assert.equal(findTicketConfigByChannelCategory(TICKETS, '333333333333333333'), null);
    assert.equal(findTicketConfigByChannelCategory(TICKETS, null), null);
    assert.equal(findTicketConfigByChannelCategory(undefined, '111111111111111111'), null);
});

test('seul un message du bot portant le bouton Fermer est reconnu comme message a boutons', () => {
    assert.equal(isTicketControlsMessage(buildControlsMessage('bot-1', 1), 'bot-1'), true);
    assert.equal(isTicketControlsMessage(buildControlsMessage('autre-bot', 1), 'bot-1'), false);
    assert.equal(isTicketControlsMessage({ author: { id: 'bot-1' }, components: [] }, 'bot-1'), false);
    assert.equal(isTicketControlsMessage({ author: { id: 'bot-1' } }, 'bot-1'), false);
    assert.equal(isTicketControlsMessage(null, 'bot-1'), false);
});

test('c est le message a boutons le plus ancien du salon qui est reutilise', () => {
    const recent = buildControlsMessage('bot-1', 200);
    const ancien = buildControlsMessage('bot-1', 100);
    const messages = [recent, { author: { id: 'humain' }, createdTimestamp: 50, components: [] }, ancien];

    assert.equal(findTicketControlsMessage(messages, 'bot-1'), ancien);
    assert.equal(findTicketControlsMessage([], 'bot-1'), null);
    assert.equal(findTicketControlsMessage(messages, undefined), null);
});

test('le mode silencieux est encode dans le customId du menu d acquisition', () => {
    const service = new TicketService({}, {}, {});

    assert.equal(service.buildAcquireCustomId('123456789012345678'), 'ticket:acquire-confirm:123456789012345678');
    assert.equal(service.buildAcquireCustomId('123456789012345678', true), 'ticket:acquire-confirm:123456789012345678:silent');
    assert.deepEqual(service.parseAcquireCustomId('ticket:acquire-confirm:123456789012345678'), {
        ownerId: '123456789012345678',
        silent: false
    });
    assert.deepEqual(service.parseAcquireCustomId('ticket:acquire-confirm:123456789012345678:silent'), {
        ownerId: '123456789012345678',
        silent: true
    });
    assert.equal(service.parseAcquireCustomId('ticket:acquire-confirm:abc'), null);
    assert.equal(service.parseAcquireCustomId(undefined), null);
});

function buildService({ existingMessage = null } = {}) {
    const client = {
        user: { id: 'bot-1' },
        config: { tickets: TICKETS, bot: { color: '#ffffff', footerText: 'SPRUNK' } }
    };
    const sent = [];
    const edited = [];
    const fetched = existingMessage ? [existingMessage] : [];
    const channel = {
        id: 'chan-1',
        topic: null,
        parentId: '222222222222222222',
        toString: () => '#salon',
        messages: { fetch: async () => new Map(fetched.map((message, index) => [String(index), message])) },
        permissionOverwrites: { set: async () => {} },
        setTopic: async topic => { channel.topic = topic; },
        send: async payload => { sent.push(payload); return { ...payload, editedTimestamp: null }; }
    };
    if (existingMessage) {
        existingMessage.edit = async payload => { edited.push(payload); return { ...payload, editedTimestamp: 1 }; };
    }
    const service = new TicketService(client, {}, { send: async () => {} });
    return { service, channel, sent, edited };
}

function buildInteraction(channel) {
    const replies = [];
    return {
        replies,
        channel,
        member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        user: { id: 'staff-1', tag: 'staff#0001' },
        guild: { id: 'guild-1', members: { fetch: async () => ({ user: { id: 'owner-1', username: 'proprio' }, displayName: 'Proprio' }) } },
        editReply: async payload => { replies.push(payload); return payload; },
        deferUpdate: async () => {}
    };
}

test('une acquisition silencieuse ne mentionne personne et coupe la notification', async () => {
    const { service, channel, sent } = buildService();
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', '123456789012345678', { silent: true, deferred: true });

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
    assert.equal(sent[0].flags, 4096); // MessageFlags.SuppressNotifications
    assert.match(channel.topic, /^sprunk-ticket\|owner=123456789012345678\|category=architecture$/);
    assert.match(interaction.replies.at(-1).content, /Salon acquis/);
});

test('une acquisition normale mentionne le proprietaire et le role staff', async () => {
    const { service, channel, sent } = buildService();
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', '123456789012345678', { deferred: true });

    assert.deepEqual(sent[0].allowedMentions, { users: ['123456789012345678'], roles: ['888888888888888888'] });
    assert.equal(sent[0].flags, undefined);
});

test('un message a boutons deja poste par le bot est mis a jour au lieu d en poster un second', async () => {
    const existingMessage = buildControlsMessage('bot-1', 100);
    const { service, channel, sent, edited } = buildService({ existingMessage });
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', '123456789012345678', { deferred: true });

    assert.equal(sent.length, 0);
    assert.equal(edited.length, 1);
    assert.equal(edited[0].components.length >= 1, true);
    assert.match(interaction.replies.at(-1).content, /mis à jour/);
});

test('un salon deja ticket ne peut pas etre acquis une seconde fois', async () => {
    const { service, channel, sent } = buildService();
    channel.topic = 'sprunk-ticket|owner=123456789012345678|category=direction';
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', '123456789012345678', { deferred: true });

    assert.equal(sent.length, 0);
    assert.match(interaction.replies.at(-1).content, /déjà un ticket/);
});
