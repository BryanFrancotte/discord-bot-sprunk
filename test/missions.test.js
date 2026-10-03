'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
    applyMissionEdit,
    buildEditConfirmCustomId,
    buildMissionThreadName,
    canEditMission,
    parseEditConfirmCustomId,
    parseMissionEdit
} = require('../src/utils/missions');

const MESSAGE_ID = '123456789012345678';
const CREATOR_ID = '223456789012345678';
const STAFF_ROLE_ID = '323456789012345678';
const config = { bot: { reassignRoleId: STAFF_ROLE_ID } };

function member(id, { roles = [], admin = false } = {}) {
    return {
        id,
        roles: { cache: new Set(roles) },
        permissions: { has: flag => admin && flag === PermissionFlagsBits.Administrator }
    };
}

const validInput = {
    title: 'Convoi',
    description: 'Escorter le camion',
    location: 'Entrepôt',
    dateText: '15/07/2027 21:00',
    maxText: '4'
};
const now = Date.parse('2027-07-01T00:00:00Z');

test('le customId du modal de modification transporte l’ID du message', () => {
    assert.equal(parseEditConfirmCustomId(buildEditConfirmCustomId(MESSAGE_ID)), MESSAGE_ID);
    assert.equal(parseEditConfirmCustomId('mission:edit-confirm:abc'), null);
    assert.equal(parseEditConfirmCustomId('ticket:rename-confirm'), null);
    assert.equal(parseEditConfirmCustomId(undefined), null);
});

test('seuls le créateur et le staff peuvent modifier une mission', () => {
    const mission = { createdBy: CREATOR_ID };

    assert.equal(canEditMission(member(CREATOR_ID), mission, config), true);
    assert.equal(canEditMission({ user: { id: CREATOR_ID } }, mission, config), true);
    assert.equal(canEditMission(member('999999999999999999', { roles: [STAFF_ROLE_ID] }), mission, config), true);
    assert.equal(canEditMission(member('999999999999999999', { admin: true }), mission, config), true);
    assert.equal(canEditMission(member('999999999999999999'), mission, config), false);
});

test('le nom du fil reste sous la limite Discord de 100 caractères', () => {
    assert.equal(buildMissionThreadName('Convoi'), '📋 Convoi');
    assert.ok(buildMissionThreadName('x'.repeat(100)).length <= 100);
});

test('parseMissionEdit accepte une saisie valide', () => {
    const { values, error } = parseMissionEdit(
        { ...validInput, title: '  Convoi  ' },
        { now, currentTimestamp: 0 }
    );

    assert.equal(error, undefined);
    assert.deepEqual(values, {
        title: 'Convoi',
        description: 'Escorter le camion',
        location: 'Entrepôt',
        timestamp: Date.parse('2027-07-15T19:00:00Z'),
        maxParticipants: 4
    });
});

test('parseMissionEdit traite un nombre de places vide ou 0 comme illimité', () => {
    assert.equal(parseMissionEdit({ ...validInput, maxText: '' }, { now, currentTimestamp: 0 }).values.maxParticipants, 0);
    assert.equal(parseMissionEdit({ ...validInput, maxText: '0' }, { now, currentTimestamp: 0 }).values.maxParticipants, 0);
});

test('parseMissionEdit rejette les saisies invalides', () => {
    const options = { now, currentTimestamp: 0 };

    assert.ok(parseMissionEdit({ ...validInput, title: '   ' }, options).error);
    assert.ok(parseMissionEdit({ ...validInput, dateText: '31/02/2027 21:00' }, options).error);
    assert.ok(parseMissionEdit({ ...validInput, dateText: '15/06/2027 21:00' }, options).error);
    assert.ok(parseMissionEdit({ ...validInput, maxText: '101' }, options).error);
    assert.ok(parseMissionEdit({ ...validInput, maxText: '-3' }, options).error);
    assert.ok(parseMissionEdit({ ...validInput, maxText: 'deux' }, options).error);
});

test('parseMissionEdit accepte une date passée si elle n’a pas changé', () => {
    const pastTimestamp = Date.parse('2027-06-15T19:00:00Z');
    const result = parseMissionEdit(
        { ...validInput, dateText: '15/06/2027 21:00' },
        { now, currentTimestamp: pastTimestamp }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.values.timestamp, pastTimestamp);
});

function sentMission() {
    return {
        title: 'Convoi',
        description: 'Escorter le camion',
        location: 'Entrepôt',
        timestamp: 1000,
        maxParticipants: 4,
        reminded15m: true,
        reminded5m: true,
        remindedNow: false,
        cleanedUp: false,
        notificationIds: ['n1']
    };
}

test('applyMissionEdit liste les champs modifiés sans toucher aux rappels si la date ne change pas', () => {
    const mission = sentMission();
    const changes = applyMissionEdit(mission, {
        title: 'Convoi lourd',
        description: 'Escorter le camion',
        location: 'Port',
        timestamp: 1000,
        maxParticipants: 4
    });

    assert.deepEqual(changes, ['titre', 'lieu']);
    assert.equal(mission.title, 'Convoi lourd');
    assert.equal(mission.location, 'Port');
    assert.equal(mission.reminded15m, true);
    assert.equal(mission.reminded5m, true);
});

test('applyMissionEdit réarme les rappels quand la date change', () => {
    const mission = sentMission();
    const changes = applyMissionEdit(mission, { ...sentMission(), timestamp: 5000, maxParticipants: 0 });

    assert.deepEqual(changes, ['date', 'places']);
    assert.equal(mission.timestamp, 5000);
    assert.equal(mission.reminded15m, false);
    assert.equal(mission.reminded5m, false);
    assert.equal(mission.remindedNow, false);
    assert.equal(mission.cleanedUp, false);
    assert.deepEqual(mission.notificationIds, ['n1']);
});

test('applyMissionEdit ne signale rien quand rien ne change', () => {
    const mission = sentMission();
    assert.deepEqual(applyMissionEdit(mission, sentMission()), []);
});
