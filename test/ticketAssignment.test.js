'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TicketService = require('../src/services/TicketService');
const TicketAssignmentService = require('../src/services/TicketAssignmentService');
const {
    buildChannelName,
    canChangeStatus,
    findArchitectByEmoji,
    getAssignmentConfig,
    resolveAssignee,
    splitChannelName
} = require('../src/utils/ticketAssignment');

const OWNER_ID = '100000000000000001';
const ARCHITECT_ID = '100000000000000002';
const OTHER_ARCHITECT_ID = '100000000000000003';
const STAFF_ID = '100000000000000004';
const ARCHITECT_ROLE_ID = '200000000000000001';
const REASSIGN_ROLE_ID = '200000000000000002';

const ARCHITECTURE = {
    id: 'architecture',
    label: 'Architecture',
    title: 'Architecture',
    description: 'Bonjour {user}',
    staffRoleId: ARCHITECT_ROLE_ID,
    assignment: {
        architects: { [ARCHITECT_ID]: '🦊', [OTHER_ARCHITECT_ID]: '🐻' }
    }
};

const CONFIG = {
    bot: { reassignRoleId: REASSIGN_ROLE_ID, color: '#00ff11', footerText: 'SPRUNK' },
    tickets: [ARCHITECTURE, { id: 'support', label: 'Support', title: 'Support', description: 'Bonjour' }]
};

function buildMember(id, roleIds = []) {
    return {
        id,
        displayName: `membre-${id.slice(-1)}`,
        user: { id, tag: `membre#${id.slice(-4)}` },
        roles: { cache: new Set(roleIds) },
        permissions: { has: () => false }
    };
}

const MEMBERS = {
    [ARCHITECT_ID]: buildMember(ARCHITECT_ID, [ARCHITECT_ROLE_ID]),
    [OTHER_ARCHITECT_ID]: buildMember(OTHER_ARCHITECT_ID, [ARCHITECT_ROLE_ID]),
    [STAFF_ID]: buildMember(STAFF_ID, [REASSIGN_ROLE_ID]),
    [OWNER_ID]: buildMember(OWNER_ID)
};

test('le nom d’un ticket se décompose en emoji architecte, base et emoji statut', () => {
    assert.deepEqual(splitChannelName('ticket-bob-architecture'), {
        architectEmoji: null, base: 'ticket-bob-architecture', statusEmoji: null
    });
    assert.deepEqual(splitChannelName('ticket-bob-architecture-⚪'), {
        architectEmoji: null, base: 'ticket-bob-architecture', statusEmoji: '⚪'
    });
    assert.deepEqual(splitChannelName('🦊-ticket-bob-architecture-🟠'), {
        architectEmoji: '🦊', base: 'ticket-bob-architecture', statusEmoji: '🟠'
    });
    assert.deepEqual(splitChannelName('👩‍🎨-ticket-bob-✅'), {
        architectEmoji: '👩‍🎨', base: 'ticket-bob', statusEmoji: '✅'
    });
});

test('le nom reconstruit reste sous la limite Discord de 100 caractères', () => {
    assert.equal(buildChannelName({ base: 'ticket-bob', statusEmoji: '⚪' }), 'ticket-bob-⚪');
    assert.equal(buildChannelName({ architectEmoji: '🦊', base: 'ticket-bob', statusEmoji: '🟠' }), '🦊-ticket-bob-🟠');

    const name = buildChannelName({ architectEmoji: '🦊', base: 'a'.repeat(100), statusEmoji: '🟠' });
    assert.ok(name.length <= 100);
    assert.ok(name.startsWith('🦊-') && name.endsWith('-🟠'));
});

test('changer de statut ou d’architecte ne remplace que l’emoji concerné', () => {
    const current = splitChannelName('🦊-ticket-bob-🟠');

    assert.equal(buildChannelName({ ...current, statusEmoji: '💰' }), '🦊-ticket-bob-💰');
    assert.equal(buildChannelName({ ...current, architectEmoji: '🐻' }), '🐻-ticket-bob-🟠');
});

test('seules les catégories avec un bloc assignment ont l’assignation, statuts par défaut compris', () => {
    assert.equal(getAssignmentConfig(CONFIG.tickets[1]), null);

    const assignment = getAssignmentConfig(ARCHITECTURE);
    assert.deepEqual(Object.keys(assignment.statuses), ['pending', 'inProgress', 'paid', 'done']);
    assert.equal(assignment.statuses.paid.label, 'Payé');
    assert.equal(findArchitectByEmoji(assignment, '🐻'), OTHER_ARCHITECT_ID);

    const custom = getAssignmentConfig({ assignment: { statuses: { done: { emoji: '🏁' } } } });
    assert.equal(custom.statuses.done.emoji, '🏁');
    assert.equal(custom.statuses.done.label, 'Terminé');
});

test('le staff assigne n’importe quel architecte, un architecte seulement lui-même', () => {
    const staff = MEMBERS[STAFF_ID];
    const architect = MEMBERS[ARCHITECT_ID];

    assert.equal(resolveAssignee(staff, MEMBERS[OTHER_ARCHITECT_ID], ARCHITECTURE, CONFIG).emoji, '🐻');
    assert.equal(resolveAssignee(architect, architect, ARCHITECTURE, CONFIG).emoji, '🦊');
    assert.match(resolveAssignee(architect, MEMBERS[OTHER_ARCHITECT_ID], ARCHITECTURE, CONFIG).error, /vous-même/);
    assert.match(resolveAssignee(staff, MEMBERS[OWNER_ID], ARCHITECTURE, CONFIG).error, /rôle des architectes/);
    assert.match(resolveAssignee(staff, null, ARCHITECTURE, CONFIG).error, /rôle des architectes/);
    assert.match(resolveAssignee(staff, MEMBERS[ARCHITECT_ID], CONFIG.tickets[1], CONFIG).error, /pas disponible/);

    const staffArchitect = buildMember(STAFF_ID, [ARCHITECT_ROLE_ID, REASSIGN_ROLE_ID]);
    assert.match(resolveAssignee(staff, staffArchitect, ARCHITECTURE, CONFIG).error, /Aucun emoji/);
});

test('le staff et les architectes peuvent changer le statut, pas le propriétaire', () => {
    assert.equal(canChangeStatus(MEMBERS[STAFF_ID], ARCHITECTURE, CONFIG), true);
    assert.equal(canChangeStatus(MEMBERS[ARCHITECT_ID], ARCHITECTURE, CONFIG), true);
    assert.equal(canChangeStatus(MEMBERS[OWNER_ID], ARCHITECTURE, CONFIG), false);
});

function buildServices() {
    const logs = [];
    const client = { user: { id: 'bot-1' }, config: CONFIG };
    const discordLogService = { send: async (guild, embed) => { logs.push(embed); } };
    const tickets = new TicketService(client, {}, discordLogService);
    const assignment = new TicketAssignmentService(client, tickets, discordLogService);
    return { tickets, assignment, logs };
}

function buildChannel(name, categoryId = 'architecture') {
    const calls = { setName: [], send: [] };
    const channel = {
        id: '300000000000000001',
        name,
        topic: `sprunk-ticket|owner=${OWNER_ID}|category=${categoryId}`,
        setName: async newName => {
            calls.setName.push(newName);
            channel.name = newName;
        },
        send: async payload => { calls.send.push(payload); },
        toString: () => `<#${channel.id}>`
    };
    return { channel, calls };
}

function buildInteraction(channel, memberId, { select = false } = {}) {
    const replies = [];
    const member = MEMBERS[memberId];
    return {
        replies,
        channel,
        member,
        user: member.user,
        guild: { members: { fetch: async id => MEMBERS[id] ?? Promise.reject(new Error('inconnu')) } },
        isStringSelectMenu: () => select,
        deferReply: async () => undefined,
        deferUpdate: async () => undefined,
        editReply: async payload => { replies.push(typeof payload === 'string' ? payload : payload.content); }
    };
}

test('assigner un ticket pose l’emoji de l’architecte et passe le statut en cours', async () => {
    const { assignment, logs } = buildServices();
    const { channel, calls } = buildChannel('ticket-bob-architecture-⚪');

    await assignment.assignTicket(buildInteraction(channel, STAFF_ID, { select: true }), ARCHITECT_ID);

    assert.deepEqual(calls.setName, ['🦊-ticket-bob-architecture-🟠']);
    assert.match(calls.send[0].content, new RegExp(`🦊 Ticket pris en charge par <@${ARCHITECT_ID}>`));
    assert.deepEqual(calls.send[0].allowedMentions.users, [ARCHITECT_ID]);
    assert.equal(logs.length, 1);
});

test('réassigner un ticket payé change l’architecte sans revenir à « en cours »', async () => {
    const { assignment } = buildServices();
    const { channel, calls } = buildChannel('🦊-ticket-bob-architecture-💰');

    await assignment.assignTicket(buildInteraction(channel, STAFF_ID), OTHER_ARCHITECT_ID);

    assert.deepEqual(calls.setName, ['🐻-ticket-bob-architecture-💰']);
});

test('un architecte ne peut pas assigner un ticket à un autre architecte', async () => {
    const { assignment } = buildServices();
    const { channel, calls } = buildChannel('ticket-bob-architecture-⚪');
    const interaction = buildInteraction(channel, ARCHITECT_ID);

    await assignment.assignTicket(interaction, OTHER_ARCHITECT_ID);

    assert.equal(calls.setName.length + calls.send.length, 0);
    assert.match(interaction.replies.at(-1), /vous-même/);
});

test('l’assignation est refusée hors des catégories configurées', async () => {
    const { assignment } = buildServices();
    const { channel, calls } = buildChannel('ticket-bob-support', 'support');
    const interaction = buildInteraction(channel, STAFF_ID);

    await assignment.assignTicket(interaction, ARCHITECT_ID);

    assert.equal(calls.setName.length, 0);
    assert.match(interaction.replies.at(-1), /pas disponible/);
});

test('changer le statut remplace seulement l’emoji de fin et respecte la limite de renommage', async () => {
    const { assignment } = buildServices();
    const { channel, calls } = buildChannel('🦊-ticket-bob-architecture-🟠');

    await assignment.setStatus(buildInteraction(channel, ARCHITECT_ID, { select: true }), 'paid');
    await assignment.setStatus(buildInteraction(channel, ARCHITECT_ID, { select: true }), 'done');
    const blocked = buildInteraction(channel, ARCHITECT_ID, { select: true });
    await assignment.setStatus(blocked, 'inProgress');

    assert.deepEqual(calls.setName, ['🦊-ticket-bob-architecture-💰', '🦊-ticket-bob-architecture-✅']);
    assert.equal(calls.send.length, 2);
    assert.match(blocked.replies.at(-1), /⏳/);
});

test('le propriétaire du ticket ne peut pas changer son statut', async () => {
    const { assignment } = buildServices();
    const { channel, calls } = buildChannel('ticket-bob-architecture-⚪');
    const interaction = buildInteraction(channel, OWNER_ID, { select: true });

    await assignment.setStatus(interaction, 'done');

    assert.equal(calls.setName.length, 0);
    assert.match(interaction.replies.at(-1), /Non autorisé/);
});

test('les boutons Assigner / Statut n’apparaissent que pour les catégories configurées', () => {
    const { tickets } = buildServices();

    const architectureRows = tickets.buildTicketComponents(ARCHITECTURE).map(row => row.toJSON());
    assert.equal(architectureRows.length, 2);
    assert.deepEqual(architectureRows[1].components.map(button => button.custom_id), ['ticket:assign', 'ticket:status']);
    assert.equal(tickets.buildTicketComponents(CONFIG.tickets[1]).length, 1);
});
