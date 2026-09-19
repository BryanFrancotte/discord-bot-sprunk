'use strict';

const { canManageBot, hasRole } = require('./permissions');

const STATUS_KEYS = ['pending', 'inProgress', 'paid', 'done'];

const DEFAULT_STATUSES = {
    pending: { label: 'En attente', emoji: '⚪' },
    inProgress: { label: 'En cours', emoji: '🟠' },
    paid: { label: 'Payé', emoji: '💰' },
    done: { label: 'Terminé', emoji: '✅' }
};

// Un « groupe d’emojis » : pictogrammes, drapeaux, modificateurs de teinte, ZWJ et sélecteurs de variante.
const EMOJI_GROUP = '(?:[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u{1F3FB}-\\u{1F3FF}\\u200D\\uFE0F\\u20E3])+';
const LEADING_EMOJI = new RegExp(`^(${EMOJI_GROUP})-?`, 'u');
const TRAILING_EMOJI = new RegExp(`-?(${EMOJI_GROUP})$`, 'u');

const MAX_CHANNEL_NAME_LENGTH = 100;

// L’assignation n’existe que pour les catégories qui déclarent un bloc `assignment` dans config.json.
function getAssignmentConfig(ticketConfig) {
    const assignment = ticketConfig?.assignment;
    if (!assignment || typeof assignment !== 'object') return null;

    const statuses = {};
    for (const key of STATUS_KEYS) {
        const configured = assignment.statuses?.[key] ?? {};
        statuses[key] = {
            key,
            label: String(configured.label || DEFAULT_STATUSES[key].label).trim(),
            emoji: String(configured.emoji || DEFAULT_STATUSES[key].emoji).trim()
        };
    }

    const architects = {};
    for (const [userId, emoji] of Object.entries(assignment.architects ?? {})) {
        if (String(emoji ?? '').trim()) architects[userId] = String(emoji).trim();
    }

    return { architects, statuses };
}

// Les noms de base viennent de sanitizeChannelName, qui ne produit jamais d’emoji :
// tout emoji en tête est celui de l’architecte, tout emoji en fin est le statut.
function splitChannelName(name) {
    let base = String(name ?? '');
    let architectEmoji = null;
    let statusEmoji = null;

    const leading = LEADING_EMOJI.exec(base);
    if (leading) {
        architectEmoji = leading[1];
        base = base.slice(leading[0].length);
    }

    const trailing = TRAILING_EMOJI.exec(base);
    if (trailing) {
        statusEmoji = trailing[1];
        base = base.slice(0, base.length - trailing[0].length);
    }

    return { architectEmoji, base, statusEmoji };
}

function buildChannelName({ architectEmoji = null, base, statusEmoji = null }) {
    const decorationLength = (architectEmoji ? architectEmoji.length + 1 : 0) +
        (statusEmoji ? statusEmoji.length + 1 : 0);
    const trimmedBase = String(base ?? '').slice(0, Math.max(1, MAX_CHANNEL_NAME_LENGTH - decorationLength));

    return [architectEmoji, trimmedBase, statusEmoji].filter(Boolean).join('-');
}

function findStatusByEmoji(assignment, emoji) {
    if (!emoji) return null;
    return Object.values(assignment.statuses).find(status => status.emoji === emoji) ?? null;
}

function findArchitectByEmoji(assignment, emoji) {
    if (!emoji) return null;
    return Object.entries(assignment.architects).find(([, value]) => value === emoji)?.[0] ?? null;
}

// Staff : peut assigner n’importe quel architecte. Architecte : ne peut assigner que lui-même.
function resolveAssignee(member, targetMember, ticketConfig, config) {
    const assignment = getAssignmentConfig(ticketConfig);
    if (!assignment) return { error: '❌ L’assignation n’est pas disponible pour cette catégorie.' };

    if (!canManageBot(member, config) && member?.id !== targetMember?.id) {
        return { error: '❌ Vous ne pouvez assigner un ticket qu’à vous-même.' };
    }
    if (!targetMember || !hasRole(targetMember, ticketConfig.staffRoleId)) {
        return { error: '❌ Ce membre n’a pas le rôle des architectes de cette catégorie.' };
    }

    const emoji = assignment.architects[targetMember.id];
    if (!emoji) {
        return {
            error: `❌ Aucun emoji configuré pour <@${targetMember.id}> (tickets[].assignment.architects dans config.json).`
        };
    }

    return { emoji, assignment };
}

function canChangeStatus(member, ticketConfig, config) {
    return canManageBot(member, config) || hasRole(member, ticketConfig?.staffRoleId);
}

module.exports = {
    DEFAULT_STATUSES,
    STATUS_KEYS,
    buildChannelName,
    canChangeStatus,
    findArchitectByEmoji,
    findStatusByEmoji,
    getAssignmentConfig,
    resolveAssignee,
    splitChannelName
};
