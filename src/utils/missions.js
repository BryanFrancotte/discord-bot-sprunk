'use strict';

const { parseParisDate } = require('./date');
const { canManageBot } = require('./permissions');

const MISSION_EDIT_CUSTOM_ID = 'mission:edit';
const MISSION_EDIT_CONFIRM_PREFIX = 'mission:edit-confirm:';

const EDITABLE_FIELDS = [
    ['title', 'titre'],
    ['description', 'description'],
    ['location', 'lieu'],
    ['timestamp', 'date'],
    ['maxParticipants', 'places']
];

function buildEditConfirmCustomId(messageId) {
    return `${MISSION_EDIT_CONFIRM_PREFIX}${messageId}`;
}

function parseEditConfirmCustomId(customId) {
    if (!customId?.startsWith(MISSION_EDIT_CONFIRM_PREFIX)) return null;
    const messageId = customId.slice(MISSION_EDIT_CONFIRM_PREFIX.length);
    return /^\d{17,20}$/.test(messageId) ? messageId : null;
}

function canEditMission(member, mission, config) {
    const memberId = member?.id ?? member?.user?.id;
    return Boolean(mission && memberId && memberId === mission.createdBy) || canManageBot(member, config);
}

function buildMissionThreadName(title) {
    return `📋 ${title}`.slice(0, 100);
}

// Une date inchangée reste acceptée même passée : on peut corriger le lieu
// ou la description d'une mission déjà lancée sans devoir la reprogrammer.
function parseMissionEdit({ title, description, location, dateText, maxText }, { now, currentTimestamp }) {
    const values = {
        title: String(title ?? '').trim(),
        description: String(description ?? '').trim(),
        location: String(location ?? '').trim(),
        timestamp: null,
        maxParticipants: 0
    };

    if (!values.title || !values.description || !values.location) {
        return { error: '❌ Le titre, la description et le lieu ne peuvent pas être vides.' };
    }

    const targetDate = parseParisDate(String(dateText ?? '').trim());
    if (!targetDate) {
        return { error: '❌ Date invalide. Utilisez JJ/MM/AAAA HH:mm avec une heure valide à Paris.' };
    }
    values.timestamp = targetDate.getTime();
    if (values.timestamp !== currentTimestamp && values.timestamp <= now) {
        return { error: '❌ La nouvelle date est déjà passée.' };
    }

    const max = String(maxText ?? '').trim();
    if (max) {
        if (!/^\d{1,3}$/.test(max) || Number(max) > 100) {
            return { error: '❌ Le nombre de places doit être un entier entre 1 et 100 (vide ou 0 = illimité).' };
        }
        values.maxParticipants = Number(max);
    }

    return { values };
}

// Retourne les libellés des champs modifiés. Un changement de date réarme les
// rappels : ceux déjà envoyés pour l'ancienne heure ne valent plus pour la nouvelle.
function applyMissionEdit(mission, values) {
    const changes = EDITABLE_FIELDS
        .filter(([key]) => mission[key] !== values[key])
        .map(([, label]) => label);

    if (mission.timestamp !== values.timestamp) {
        mission.reminded15m = false;
        mission.reminded5m = false;
        mission.remindedNow = false;
        mission.cleanedUp = false;
    }

    for (const [key] of EDITABLE_FIELDS) {
        mission[key] = values[key];
    }

    return changes;
}

module.exports = {
    MISSION_EDIT_CUSTOM_ID,
    applyMissionEdit,
    buildEditConfirmCustomId,
    buildMissionThreadName,
    canEditMission,
    parseEditConfirmCustomId,
    parseMissionEdit
};
