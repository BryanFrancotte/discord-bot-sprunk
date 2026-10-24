'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ConfigService = require('../src/core/ConfigService');
const PictureValidationService = require('../src/services/PictureValidationService');
const TicketService = require('../src/services/TicketService');
const {
    buildPictureCustomId,
    canReviewPicturesInThread,
    getPictureValidationConfig,
    isImageAttachment,
    isPictureReviewer,
    parsePictureCustomId
} = require('../src/utils/pictureValidation');

const OWNER_ID = '100000000000000001';
const EVENT_STAFF_ID = '100000000000000002';
const OTHER_STAFF_ID = '100000000000000003';
const MANAGER_ID = '100000000000000004';
const EVENT_ROLE_ID = '200000000000000001';
const OTHER_ROLE_ID = '200000000000000002';
const REASSIGN_ROLE_ID = '200000000000000003';
const THREAD_ID = '300000000000000001';
const CHANNEL_ID = '400000000000000001';
const MESSAGE_ID = '500000000000000001';

const EVENT = {
    id: 'evenement',
    label: 'Événement',
    title: 'Événement',
    description: 'Bonjour {user}',
    staffRoleId: EVENT_ROLE_ID,
    pictureValidation: { threadId: THREAD_ID }
};

const SUPPORT = { id: 'support', label: 'Support', title: 'Support', description: 'Bonjour', staffRoleId: OTHER_ROLE_ID };

const CONFIG = {
    bot: { guildId: '123456789012345678', reassignRoleId: REASSIGN_ROLE_ID, color: '#00ff11', footerText: 'SPRUNK' },
    tickets: [EVENT, SUPPORT]
};

function buildMember(id, roleIds = []) {
    return {
        id,
        displayName: `membre-${id.slice(-1)}`,
        roles: { cache: new Set(roleIds) },
        permissions: { has: () => false }
    };
}

function buildMessage({ member = buildMember(OWNER_ID), topic, attachments }) {
    return {
        id: MESSAGE_ID,
        channelId: CHANNEL_ID,
        member,
        author: { id: member.id, username: 'membre', toString: () => `<@${member.id}>` },
        channel: { topic, toString: () => `<#${CHANNEL_ID}>` },
        attachments: new Map(attachments.map((attachment, index) => [String(index), attachment])),
        content: 'Ma photo de l’événement',
        url: `https://discord.com/channels/1/${CHANNEL_ID}/${MESSAGE_ID}`,
        createdAt: new Date('2026-10-24T20:00:00Z')
    };
}

function buildService(config = CONFIG) {
    const client = { config, user: { id: '900000000000000001' } };
    return new PictureValidationService(client, new TicketService(client, null, null), null);
}

const IMAGE = { name: 'photo.png', contentType: 'image/png', url: 'https://cdn.discordapp.com/photo.png' };
const EVENT_TOPIC = `sprunk-ticket|owner=${OWNER_ID}|category=evenement`;

test('la validation des photos n’existe que pour une catégorie avec un fil valide', () => {
    assert.deepEqual(getPictureValidationConfig(EVENT), { threadId: THREAD_ID });
    assert.equal(getPictureValidationConfig(SUPPORT), null);
    assert.equal(getPictureValidationConfig({ ...EVENT, pictureValidation: { threadId: '' } }), null);
    assert.equal(getPictureValidationConfig(undefined), null);
});

test('une pièce jointe est une image d’après son type, ou son extension à défaut', () => {
    assert.equal(isImageAttachment({ name: 'a.png', contentType: 'image/png' }), true);
    assert.equal(isImageAttachment({ name: 'a.png', contentType: 'application/pdf' }), false);
    assert.equal(isImageAttachment({ name: 'photo.JPEG' }), true);
    assert.equal(isImageAttachment({ name: 'notes.txt' }), false);
});

test('le customId des boutons de validation porte le salon et le message du ticket', () => {
    const customId = buildPictureCustomId('approve', CHANNEL_ID, MESSAGE_ID);
    assert.ok(customId.length <= 100);
    assert.deepEqual(parsePictureCustomId(customId), { action: 'approve', channelId: CHANNEL_ID, messageId: MESSAGE_ID });
    assert.deepEqual(
        parsePictureCustomId(buildPictureCustomId('reject-confirm', CHANNEL_ID, MESSAGE_ID)),
        { action: 'reject-confirm', channelId: CHANNEL_ID, messageId: MESSAGE_ID }
    );
    assert.equal(parsePictureCustomId(`picture:delete:${CHANNEL_ID}:${MESSAGE_ID}`), null);
    assert.equal(parsePictureCustomId('mission:edit'), null);
});

test('seuls le staff de la catégorie du fil et les gestionnaires peuvent décider', () => {
    assert.equal(canReviewPicturesInThread(buildMember(EVENT_STAFF_ID, [EVENT_ROLE_ID]), CONFIG, THREAD_ID), true);
    assert.equal(canReviewPicturesInThread(buildMember(MANAGER_ID, [REASSIGN_ROLE_ID]), CONFIG, THREAD_ID), true);
    assert.equal(canReviewPicturesInThread(buildMember(OTHER_STAFF_ID, [OTHER_ROLE_ID]), CONFIG, THREAD_ID), false);
    assert.equal(canReviewPicturesInThread(buildMember(OWNER_ID), CONFIG, THREAD_ID), false);
    assert.equal(canReviewPicturesInThread(buildMember(EVENT_STAFF_ID, [EVENT_ROLE_ID]), CONFIG, '300000000000000009'), false);
    assert.equal(isPictureReviewer(buildMember(EVENT_STAFF_ID, [EVENT_ROLE_ID]), EVENT, CONFIG), true);
    assert.equal(isPictureReviewer(buildMember(OWNER_ID), EVENT, CONFIG), false);
});

test('une image du membre dans un ticket Événement part en validation', () => {
    const service = buildService();
    const submission = service.resolveSubmission(buildMessage({
        topic: EVENT_TOPIC,
        attachments: [IMAGE, { name: 'notes.txt', contentType: 'text/plain', url: 'https://cdn.discordapp.com/notes.txt' }]
    }));

    assert.equal(submission.threadId, THREAD_ID);
    assert.equal(submission.ticketConfig.id, 'evenement');
    assert.deepEqual(submission.images, [IMAGE]);
});

test('aucune validation hors ticket Événement, sans image, ou pour une photo du staff', () => {
    const service = buildService();
    assert.equal(service.resolveSubmission(buildMessage({ topic: EVENT_TOPIC, attachments: [] })), null);
    assert.equal(service.resolveSubmission(buildMessage({ topic: null, attachments: [IMAGE] })), null);
    assert.equal(service.resolveSubmission(buildMessage({
        topic: `sprunk-ticket|owner=${OWNER_ID}|category=support`,
        attachments: [IMAGE]
    })), null);
    assert.equal(service.resolveSubmission(buildMessage({
        member: buildMember(EVENT_STAFF_ID, [EVENT_ROLE_ID]),
        topic: EVENT_TOPIC,
        attachments: [IMAGE]
    })), null);
});

test('la demande dans le fil propose Valider / Refuser pour le message d’origine', () => {
    const service = buildService();
    const payload = service.buildReviewPayload(buildMessage({ topic: EVENT_TOPIC, attachments: [IMAGE] }), [IMAGE]);
    const embed = payload.embeds[0].toJSON();
    const [row] = payload.components.map(component => component.toJSON());

    assert.equal(embed.title, '📸 PHOTO À VALIDER');
    assert.match(embed.description, new RegExp(`/${CHANNEL_ID}/${MESSAGE_ID}`));
    assert.deepEqual(row.components.map(button => button.custom_id), [
        buildPictureCustomId('approve', CHANNEL_ID, MESSAGE_ID),
        buildPictureCustomId('reject', CHANNEL_ID, MESSAGE_ID)
    ]);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('la décision met à jour l’embed du fil et le message prévenant le membre', () => {
    const service = buildService();
    const original = service.buildReviewPayload(buildMessage({ topic: EVENT_TOPIC, attachments: [IMAGE] }), [IMAGE]).embeds[0].toJSON();

    const approved = service.buildDecisionEmbed(original, { approved: true, reason: null }, '<@2>').toJSON();
    assert.equal(approved.title, '✅ PHOTO VALIDÉE');
    assert.equal(approved.description, original.description);
    assert.deepEqual(approved.fields.map(field => field.name), ['Décision']);

    const rejected = service.buildDecisionEmbed(original, { approved: false, reason: 'Photo floue' }, '<@2>').toJSON();
    assert.equal(rejected.title, '❌ PHOTO REFUSÉE');
    assert.deepEqual(rejected.fields.map(field => field.value), ['Refusée par <@2>', 'Photo floue']);

    assert.equal(service.buildTicketNotice({ approved: true }, 'Alice'), '✅ Votre photo a été **validée** par Alice.');
    assert.equal(
        service.buildTicketNotice({ approved: false, reason: 'Photo floue' }, 'Alice'),
        '❌ Votre photo a été **refusée** par Alice.\n**Motif :** Photo floue'
    );
});

test('ConfigService refuse un bloc pictureValidation sans fil valide', async context => {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sprunk-picture-test-'));
    context.after(() => fsp.rm(directory, { recursive: true, force: true }));
    const service = new ConfigService(path.join(directory, 'config.json'));

    assert.doesNotThrow(() => service.validate(CONFIG));
    assert.throws(
        () => service.validate({ ...CONFIG, tickets: [{ ...EVENT, pictureValidation: { threadId: 'abc' } }] }),
        /pictureValidation\.threadId/
    );
    assert.throws(
        () => service.validate({ ...CONFIG, tickets: [{ ...EVENT, pictureValidation: [] }] }),
        /pictureValidation doit être un objet/
    );
});
