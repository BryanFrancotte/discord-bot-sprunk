'use strict';

function sanitizeChannelName(value, fallback = 'ticket') {
    const sanitized = String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9-_ ]/g, '')
        .trim()
        .replace(/[ _]+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 100);

    return sanitized || fallback;
}

// Reproduit la normalisation appliquée par Discord aux salons textuels (minuscules,
// espaces en tirets) sans retirer emojis ni accents, contrairement à sanitizeChannelName.
function toTextChannelName(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .slice(0, 100);
}

function getDisplayName(member, user) {
    return member?.displayName || user?.globalName || user?.username || 'utilisateur';
}

module.exports = { getDisplayName, sanitizeChannelName, toTextChannelName };
