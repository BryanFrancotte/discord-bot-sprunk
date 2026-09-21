'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OverwriteType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const TicketService = require('../src/services/TicketService');

const TICKETS = [
    { id: 'direction', label: 'Direction', categoryId: '111111111111111111', staffRoleId: '999999999999999999' },
    { id: 'architecture', label: 'Architecture', categoryId: '222222222222222222', staffRoleId: '888888888888888888' }
];
const OWNER_ID = '100000000000000001';
const ADDED_MEMBER_ID = '100000000000000002';
const OTHER_ROLE_ID = '777777777777777777';

function buildOverwrite(id, type, { allow = [], deny = [] } = {}) {
    return { id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) };
}

// Ticket « direction » : propriétaire, membre ajouté via « Ajouter », rôle staff direction,
// un rôle ajouté à la main, @everyone en refus.
function buildTicketChannel({ failOnEditId = null } = {}) {
    const view = [PermissionFlagsBits.ViewChannel];
    const calls = [];
    const channel = {
        topic: `sprunk-ticket|owner=${OWNER_ID}|category=direction`,
        calls,
        permissionOverwrites: {
            cache: new Map([
                buildOverwrite('guild-1', OverwriteType.Role, { deny: view }),
                buildOverwrite(OWNER_ID, OverwriteType.Member, { allow: view }),
                buildOverwrite(ADDED_MEMBER_ID, OverwriteType.Member, { allow: view }),
                buildOverwrite('999999999999999999', OverwriteType.Role, { allow: view }),
                buildOverwrite(OTHER_ROLE_ID, OverwriteType.Role, { allow: view })
            ].map(overwrite => [overwrite.id, overwrite])),
            set: async () => { calls.push({ op: 'set' }); },
            edit: async (id, options, extra) => {
                if (id === failOnEditId) throw new Error('InvalidType');
                calls.push({ op: 'edit', id, options, ...extra });
            },
            delete: async id => {
                calls.push({ op: 'delete', id });
                channel.permissionOverwrites.cache.delete(id);
            }
        },
        setParent: async parentId => { calls.push({ op: 'setParent', parentId }); },
        setTopic: async topic => { channel.topic = topic; },
        send: async () => {}
    };
    return channel;
}

function buildReassign(channel) {
    const client = { user: { id: 'bot-1' }, config: { tickets: TICKETS, bot: { color: '#ffffff' } } };
    const service = new TicketService(client, {}, { send: async () => {} });
    const followUps = [];
    const interaction = {
        channel,
        member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        user: { id: 'staff-1', tag: 'staff#0001' },
        guild: { id: 'guild-1' },
        deferUpdate: async () => {},
        followUp: async payload => { followUps.push(payload); }
    };
    return { service, interaction, followUps };
}

test('la reassignation n ejecte aucun membre et aligne les roles sur la nouvelle categorie', async () => {
    const channel = buildTicketChannel();
    const { service, interaction, followUps } = buildReassign(channel);

    await service.reassignTicket(interaction, 'architecture');

    assert.equal(channel.calls.some(call => call.op === 'set'), false);
    assert.deepEqual(
        channel.calls.filter(call => call.op === 'delete').map(call => call.id),
        ['999999999999999999', OTHER_ROLE_ID]
    );
    assert.deepEqual([...channel.permissionOverwrites.cache.keys()], ['guild-1', OWNER_ID, ADDED_MEMBER_ID]);
    assert.equal(channel.topic, `sprunk-ticket|owner=${OWNER_ID}|category=architecture`);
    assert.match(followUps.at(-1).content, /Accès retirés aux rôles : <@&999999999999999999>, <@&777777777777777777>/);
});

test('la reassignation donne les acces avec un type explicite, avant tout retrait', async () => {
    const channel = buildTicketChannel();
    const { service, interaction } = buildReassign(channel);

    await service.reassignTicket(interaction, 'architecture');

    const permissionCalls = channel.calls.filter(call => call.op === 'edit' || call.op === 'delete');
    assert.deepEqual(permissionCalls.map(call => `${call.op}:${call.id}`), [
        `edit:${OWNER_ID}`,
        'edit:888888888888888888',
        'edit:bot-1',
        'delete:999999999999999999',
        `delete:${OTHER_ROLE_ID}`
    ]);
    // Sans type, discord.js résout l'ID via son cache et lève InvalidType sur un propriétaire absent.
    assert.deepEqual(permissionCalls.filter(call => call.op === 'edit').map(call => call.type), [
        OverwriteType.Member,
        OverwriteType.Role,
        OverwriteType.Member
    ]);
});

test('une erreur pendant la reassignation ne retire l acces de personne', async () => {
    const channel = buildTicketChannel({ failOnEditId: OWNER_ID });
    const { service, interaction } = buildReassign(channel);

    await assert.rejects(service.reassignTicket(interaction, 'architecture'));

    // L'ancienne équipe garde son accès : rien n'a été supprimé avant l'échec.
    assert.equal(channel.calls.some(call => call.op === 'delete'), false);
    assert.equal(channel.permissionOverwrites.cache.has('999999999999999999'), true);
});
