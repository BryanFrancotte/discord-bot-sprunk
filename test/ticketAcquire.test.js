'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OverwriteType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const TicketService = require('../src/services/TicketService');
const {
    findTicketConfigByChannelCategory,
    findTicketControlsMessage,
    isTicketControlsMessage
} = require('../src/utils/ticketMessages');
const { findObsoleteRoleOverwriteIds, findProbableOwnerId } = require('../src/utils/ticketPermissions');

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

// Overwrite tel que discord.js l'expose dans `channel.permissionOverwrites.cache`.
function buildOverwrite(id, type, { allow = [], deny = [] } = {}) {
    return { id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) };
}

function buildService({ existingMessage = null, overwrites = [], botUserIds = [] } = {}) {
    const client = {
        user: { id: 'bot-1' },
        users: { cache: new Map(botUserIds.map(id => [id, { id, bot: true }])) },
        config: { tickets: TICKETS, bot: { color: '#ffffff', footerText: 'SPRUNK' } }
    };
    const sent = [];
    const edited = [];
    const fetched = existingMessage ? [existingMessage] : [];
    const channel = {
        id: 'chan-1',
        topic: null,
        topicWrites: 0,
        parentId: '222222222222222222',
        permissionSets: [],
        permissionEdits: [],
        permissionDeletes: [],
        toString: () => '#salon',
        messages: { fetch: async () => new Map(fetched.map((message, index) => [String(index), message])) },
        permissionOverwrites: {
            cache: new Map(overwrites.map(overwrite => [overwrite.id, overwrite])),
            set: async list => { channel.permissionSets.push(list); },
            edit: async (id, options, extra) => { channel.permissionEdits.push({ id, options, ...extra }); },
            delete: async id => {
                channel.permissionDeletes.push(id);
                channel.permissionOverwrites.cache.delete(id);
            }
        },
        setTopic: async topic => { channel.topic = topic; channel.topicWrites += 1; },
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

test('acquerir un salon deja ticket met a jour son message a boutons', async () => {
    const existingMessage = buildControlsMessage('bot-1', 100);
    const { service, channel, sent, edited } = buildService({ existingMessage });
    channel.topic = 'sprunk-ticket|owner=123456789012345678|category=direction';
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', '123456789012345678', { deferred: true });

    assert.equal(sent.length, 0);
    assert.equal(edited.length, 1);
    assert.match(edited[0].embeds[0].data.description, /Mis à jour par/);
    assert.equal(channel.topic, 'sprunk-ticket|owner=123456789012345678|category=architecture');
    assert.match(interaction.replies.at(-1).content, /mis à jour/);
});

test('une acquisition n ajoute que les acces du proprietaire, du staff et du bot', async () => {
    const existingMessage = buildControlsMessage('bot-1', 100);
    const { service, channel, edited } = buildService({ existingMessage });
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', '123456789012345678', { deferred: true });

    // Jamais de `set` : il remplacerait toute la liste et éjecterait l'ouvreur du salon et les
    // membres ajoutés à la main. Et pas d'entrée `@everyone` : c'est la seule qui retirerait un accès.
    assert.equal(channel.permissionSets.length, 0);
    assert.deepEqual(channel.permissionEdits.map(entry => entry.id), [
        '123456789012345678',
        '888888888888888888',
        'bot-1'
    ]);
    // Le type est toujours transmis : sans lui, discord.js dépend de son cache pour résoudre l'ID.
    assert.deepEqual(channel.permissionEdits.map(entry => entry.type), [1, 0, 1]);
    // Que des autorisations, aucun refus.
    for (const entry of channel.permissionEdits) {
        assert.equal(entry.options.ViewChannel, true);
        assert.equal(Object.values(entry.options).includes(false), false);
    }
    assert.equal(edited.length, 1);
});

test('la mise a jour d un ticket n enleve aucune permission du salon', async () => {
    const existingMessage = buildControlsMessage('bot-1', 100);
    const { service, channel, edited } = buildService({ existingMessage });
    channel.topic = 'sprunk-ticket|owner=123456789012345678|category=architecture';
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', '123456789012345678', { deferred: true });

    assert.equal(channel.permissionSets.length, 0);
    assert.deepEqual(channel.permissionEdits.map(entry => entry.id), [
        '123456789012345678',
        '888888888888888888',
        'bot-1'
    ]);
    assert.equal(edited.length, 1);
});

test('le topic n est pas reecrit quand il est deja a jour', async () => {
    const existingMessage = buildControlsMessage('bot-1', 100);
    const { service, channel } = buildService({ existingMessage });
    channel.topic = 'sprunk-ticket|owner=123456789012345678|category=architecture';
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', '123456789012345678', { deferred: true });

    assert.equal(channel.topicWrites, 0);
});

// Salon typique à acquérir : l'ouvreur et un membre ajouté (accès individuels), l'ancien rôle
// staff d'une autre catégorie, un rôle quelconque, le rôle staff de la catégorie visée, @everyone.
const OPENER_ID = '100000000000000001';
const ADDED_MEMBER_ID = '100000000000000002';
const OTHER_ROLE_ID = '777777777777777777';

function buildAcquirableChannelOverwrites() {
    const view = [PermissionFlagsBits.ViewChannel];
    return [
        buildOverwrite('guild-1', OverwriteType.Role, { deny: view }),
        buildOverwrite(OPENER_ID, OverwriteType.Member, { allow: view }),
        buildOverwrite(ADDED_MEMBER_ID, OverwriteType.Member, { allow: view }),
        buildOverwrite('999999999999999999', OverwriteType.Role, { allow: view }),
        buildOverwrite(OTHER_ROLE_ID, OverwriteType.Role, { allow: view }),
        buildOverwrite('888888888888888888', OverwriteType.Role, { allow: view })
    ];
}

test('seuls les overwrites de roles hors liste de conservation sont a supprimer', () => {
    const overwrites = new Map(buildAcquirableChannelOverwrites().map(overwrite => [overwrite.id, overwrite]));

    assert.deepEqual(
        findObsoleteRoleOverwriteIds(overwrites, ['guild-1', '888888888888888888']),
        ['999999999999999999', OTHER_ROLE_ID]
    );
    assert.deepEqual(findObsoleteRoleOverwriteIds(null, ['guild-1']), []);
});

test('l ouvreur probable est le seul membre ayant un acces individuel au salon', () => {
    const view = [PermissionFlagsBits.ViewChannel];
    const opener = buildOverwrite(OPENER_ID, OverwriteType.Member, { allow: view });
    const staff = buildOverwrite('staff-1', OverwriteType.Member, { allow: view });
    const bot = buildOverwrite('bot-1', OverwriteType.Member, { allow: view });
    const role = buildOverwrite(OTHER_ROLE_ID, OverwriteType.Role, { allow: view });
    const banned = buildOverwrite(ADDED_MEMBER_ID, OverwriteType.Member, { deny: view });

    // L'auteur de la commande, le bot, les rôles et les membres sans accès ne comptent pas.
    assert.equal(findProbableOwnerId([opener, staff, bot, role, banned], ['staff-1', 'bot-1']), OPENER_ID);
    // Plusieurs candidats : on ne devine pas.
    const added = buildOverwrite(ADDED_MEMBER_ID, OverwriteType.Member, { allow: view });
    assert.equal(findProbableOwnerId([opener, added], []), null);
    assert.equal(findProbableOwnerId([], []), null);
    assert.equal(findProbableOwnerId(undefined, []), null);
});

test('l acquisition retire les roles en trop mais jamais les membres ni @everyone', async () => {
    const { service, channel } = buildService({ overwrites: buildAcquirableChannelOverwrites() });
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', OPENER_ID, { deferred: true });

    assert.equal(channel.permissionSets.length, 0);
    assert.deepEqual(channel.permissionDeletes, ['999999999999999999', OTHER_ROLE_ID]);
    assert.deepEqual([...channel.permissionOverwrites.cache.keys()], [
        'guild-1',
        OPENER_ID,
        ADDED_MEMBER_ID,
        '888888888888888888'
    ]);
    assert.match(interaction.replies.at(-1).content, /Accès retirés aux rôles : <@&999999999999999999>, <@&777777777777777777>/);
});

test('sans role en trop, rien n est supprime ni annonce', async () => {
    const { service, channel } = buildService();
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', OPENER_ID, { deferred: true });

    assert.deepEqual(channel.permissionDeletes, []);
    assert.doesNotMatch(interaction.replies.at(-1).content, /Accès retirés/);
});

test('le proprietaire explicite puis le proprietaire actuel priment sur toute deduction', () => {
    const { service, channel } = buildService({ overwrites: buildAcquirableChannelOverwrites() });
    const interaction = buildInteraction(channel);

    assert.deepEqual(service.resolveAcquireOwner(interaction, '123456789012345678', null), {
        ownerId: '123456789012345678',
        note: null
    });
    assert.deepEqual(service.resolveAcquireOwner(interaction, null, { ownerId: '223456789012345678' }), {
        ownerId: '223456789012345678',
        note: null
    });
});

test('sans option ni ticket existant, l ouvreur est deduit des acces du salon et annonce', () => {
    const view = [PermissionFlagsBits.ViewChannel];
    const { service, channel } = buildService({
        overwrites: [
            buildOverwrite('guild-1', OverwriteType.Role, { deny: view }),
            buildOverwrite(OPENER_ID, OverwriteType.Member, { allow: view }),
            buildOverwrite('staff-1', OverwriteType.Member, { allow: view }),
            buildOverwrite('bot-1', OverwriteType.Member, { allow: view }),
            buildOverwrite('autre-bot', OverwriteType.Member, { allow: view })
        ],
        botUserIds: ['autre-bot']
    });
    const interaction = buildInteraction(channel);

    const { ownerId, note } = service.resolveAcquireOwner(interaction, null, null);

    assert.equal(ownerId, OPENER_ID);
    assert.match(note, /Propriétaire déduit des accès du salon : <@100000000000000001>/);
});

test('si l ouvreur ne peut pas etre deduit, l auteur devient proprietaire et en est prevenu', () => {
    const { service, channel } = buildService({ overwrites: buildAcquirableChannelOverwrites() });
    const interaction = buildInteraction(channel);

    // Deux membres ont un accès individuel : ambigu.
    const { ownerId, note } = service.resolveAcquireOwner(interaction, null, null);

    assert.equal(ownerId, 'staff-1');
    assert.match(note, /Impossible de déduire l'ouvreur/);
});

test('la note sur le proprietaire accompagne la reponse finale de l acquisition', async () => {
    const { service, channel } = buildService();
    const interaction = buildInteraction(channel);

    await service.acquireChannel(interaction, 'architecture', OPENER_ID, {
        deferred: true,
        ownerNote: 'ℹ️ Propriétaire déduit des accès du salon : <@100000000000000001>.'
    });

    assert.match(interaction.replies.at(-1).content, /Salon acquis[\s\S]*Propriétaire déduit/);
});
