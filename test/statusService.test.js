'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection } = require('discord.js');
const StatusService = require('../src/services/StatusService');
const { toTextChannelName } = require('../src/utils/text');

const CHANNEL_ID = '123456789012345678';
const ROLE_ID = '123456789012345679';

const PRESETS = {
    channelId: CHANNEL_ID,
    notificationRoleId: ROLE_ID,
    open: {
        channelName: '🟢 Ouvert',
        message: 'Le Sprunk est **ouvert** !',
        image: 'assets/statut-ouvert.png'
    },
    closed: {
        channelName: '🔴 Fermé',
        message: 'Le Sprunk est **fermé**.',
        image: 'assets/statut-ferme.png'
    }
};

function buildService(status = PRESETS) {
    const logs = [];
    const client = {
        user: { id: 'bot-1' },
        config: { bot: { footerText: 'SPRUNK' }, status }
    };
    const discordLogService = { send: async (guild, embed) => { logs.push(embed); } };
    return { service: new StatusService(client, discordLogService), logs };
}

function buildChannel({ name = '🔴-fermé', latestMessage = null } = {}) {
    const calls = { setName: [], send: [], deleted: [] };
    if (latestMessage) latestMessage.delete = async () => { calls.deleted.push(latestMessage); };

    const channel = {
        id: CHANNEL_ID,
        name,
        isTextBased: () => true,
        setName: async newName => {
            calls.setName.push(newName);
            channel.name = newName;
        },
        send: async payload => { calls.send.push(payload); },
        messages: {
            fetch: async () => new Collection(latestMessage ? [['message-1', latestMessage]] : [])
        }
    };
    return { channel, calls };
}

function buildInteraction(channel) {
    const replies = [];
    return {
        replies,
        user: { tag: 'staff#0001' },
        member: { displayName: 'Staff' },
        guild: { channels: { fetch: async id => (id === channel.id ? channel : null) } },
        deferReply: async () => undefined,
        editReply: async payload => { replies.push(payload); }
    };
}

function buildBotSign() {
    return { author: { id: 'bot-1' }, embeds: [{}] };
}

test('le nom de salon suit la normalisation Discord des salons textuels', () => {
    assert.equal(toTextChannelName('  🟢 Ouvert   Maintenant '), '🟢-ouvert-maintenant');
    assert.equal(toTextChannelName('a'.repeat(150)).length, 100);
    assert.equal(toTextChannelName(undefined), '');
});

test('le statut reprend le nom, le message et l’image prédéfinis de config.json', () => {
    const { service } = buildService();

    const status = service.resolveStatus('open');

    assert.equal(status.label, 'Ouvert');
    assert.equal(status.channelName, '🟢-ouvert');
    assert.equal(status.message, 'Le Sprunk est **ouvert** !');
    assert.equal(status.image, 'assets/statut-ouvert.png');
});

test('les options nom et message remplacent les valeurs prédéfinies', () => {
    const { service } = buildService();

    const status = service.resolveStatus('closed', { channelName: 'Fermé Inventaire', message: 'Fermé pour inventaire.' });

    assert.equal(status.channelName, 'fermé-inventaire');
    assert.equal(status.message, 'Fermé pour inventaire.');
});

test('sans section status, les options nom et message sont obligatoires', () => {
    const { service } = buildService(null);

    assert.match(service.resolveStatus('open').error, /status\.open/);
    assert.match(service.resolveStatus('open', { message: 'Ouvert !' }).error, /status\.open/);
    assert.equal(service.resolveStatus('open', { channelName: 'ouvert', message: 'Ouvert !' }).channelName, 'ouvert');
    assert.ok(service.resolveStatus('inconnu').error);
});

test('le compteur de renommages applique la limite de 2 par tranche de 10 minutes', () => {
    const { service } = buildService();

    assert.equal(service.getRenameRetryDelay(CHANNEL_ID, 0), 0);
    service.recordRename(CHANNEL_ID, 0);
    service.recordRename(CHANNEL_ID, 1000);

    assert.equal(service.getRenameRetryDelay(CHANNEL_ID, 2000), 598000);
    assert.equal(service.getRenameRetryDelay('autre-salon', 2000), 0);
    assert.equal(service.getRenameRetryDelay(CHANNEL_ID, 600000), 0);
});

test('le panneau mentionne le rôle configuré et joint l’image locale', () => {
    const { service } = buildService();

    const { payload, missingImage } = service.buildStatusPayload(service.resolveStatus('open'));

    assert.equal(payload.content, `<@&${ROLE_ID}>`);
    assert.deepEqual(payload.allowedMentions, { parse: [], roles: [ROLE_ID] });
    assert.equal(payload.files[0].name, 'statut-open.png');
    assert.equal(payload.embeds[0].toJSON().image.url, 'attachment://statut-open.png');
    assert.equal(missingImage, null);
});

test('l’option ping désactivée retire la mention du rôle', () => {
    const { service } = buildService();

    const { payload } = service.buildStatusPayload(service.resolveStatus('closed'), false);

    assert.equal(payload.content, undefined);
    assert.deepEqual(payload.allowedMentions.roles, []);
});

test('une image renseignée par URL est utilisée telle quelle, sans pièce jointe', () => {
    const { service } = buildService({
        ...PRESETS,
        open: { ...PRESETS.open, image: 'https://example.com/ouvert.png' }
    });

    const { payload } = service.buildStatusPayload(service.resolveStatus('open'));

    assert.equal(payload.embeds[0].toJSON().image.url, 'https://example.com/ouvert.png');
    assert.equal(payload.files.length, 0);
});

test('une image introuvable est signalée sans bloquer la publication', () => {
    const { service } = buildService({
        ...PRESETS,
        open: { ...PRESETS.open, image: 'assets/inexistante.png' }
    });

    const { payload, missingImage } = service.buildStatusPayload(service.resolveStatus('open'));

    assert.equal(missingImage, 'assets/inexistante.png');
    assert.equal(payload.files.length, 0);
    assert.equal(payload.embeds[0].toJSON().image, undefined);
});

test('le panneau est republié, l’ancien panneau du bot supprimé et le salon renommé', async () => {
    const { service, logs } = buildService();
    const previousSign = buildBotSign();
    const { channel, calls } = buildChannel({ latestMessage: previousSign });
    const interaction = buildInteraction(channel);

    await service.updateStatus(interaction, 'open');

    assert.deepEqual(calls.setName, ['🟢-ouvert']);
    assert.equal(calls.send.length, 1);
    assert.equal(calls.send[0].embeds[0].toJSON().description, 'Le Sprunk est **ouvert** !');
    assert.deepEqual(calls.deleted, [previousSign]);
    assert.match(interaction.replies.at(-1), /✅ Statut \*\*Ouvert\*\*.*renommé/);
    assert.equal(logs.length, 1);
});

test('un message qui n’est pas un panneau du bot n’est jamais supprimé', async () => {
    const { service } = buildService();
    const { channel, calls } = buildChannel({ latestMessage: { author: { id: 'membre-1' }, embeds: [] } });

    await service.updateStatus(buildInteraction(channel), 'open');

    assert.equal(calls.send.length, 1);
    assert.equal(calls.deleted.length, 0);
});

test('le salon n’est pas renommé si son nom est déjà le bon', async () => {
    const { service } = buildService();
    const { channel, calls } = buildChannel({ name: '🔴-fermé' });
    const interaction = buildInteraction(channel);

    await service.updateStatus(interaction, 'closed', { message: 'Fermé pour inventaire.' });

    assert.equal(calls.setName.length, 0);
    assert.equal(calls.send.length, 1);
    assert.doesNotMatch(interaction.replies.at(-1), /renommé/);
});

test('au-delà de la limite de renommage, ni le nom ni le panneau ne changent', async () => {
    const { service } = buildService();
    const { channel, calls } = buildChannel({ latestMessage: buildBotSign() });
    const now = Date.now();
    service.recordRename(CHANNEL_ID, now);
    service.recordRename(CHANNEL_ID, now);
    const interaction = buildInteraction(channel);

    await service.updateStatus(interaction, 'open');

    assert.equal(calls.setName.length, 0);
    assert.equal(calls.send.length, 0);
    assert.equal(calls.deleted.length, 0);
    assert.match(interaction.replies.at(-1), /⏳.*Réessayez dans 10 min/);
});

test('sans status.channelId, la commande explique quoi configurer', async () => {
    const { service } = buildService({ open: PRESETS.open });
    const { channel, calls } = buildChannel();
    const interaction = buildInteraction(channel);

    await service.updateStatus(interaction, 'open');

    assert.match(interaction.replies.at(-1), /status\.channelId/);
    assert.equal(calls.setName.length + calls.send.length, 0);
});
