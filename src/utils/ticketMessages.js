'use strict';

// Le bouton « Fermer » est présent sur tous les messages de contrôles postés par le bot :
// c'est lui qui sert de marqueur pour retrouver un message existant dans un salon.
const CONTROLS_MARKER_CUSTOM_ID = 'ticket:close';

function isTicketControlsMessage(message, botId) {
    if (!message || !botId || message.author?.id !== botId) return false;
    return (message.components ?? []).some(row =>
        (row?.components ?? []).some(component => component?.customId === CONTROLS_MARKER_CUSTOM_ID));
}

// Retourne le message de contrôles le plus ancien du salon (le plus haut dans l'historique),
// pour qu'une nouvelle acquisition mette à jour ce message plutôt que d'en empiler un second.
function findTicketControlsMessage(messages, botId) {
    let found = null;
    for (const message of messages ?? []) {
        if (!isTicketControlsMessage(message, botId)) continue;
        if (!found || (message.createdTimestamp ?? 0) < (found.createdTimestamp ?? 0)) found = message;
    }
    return found;
}

// La catégorie Discord qui contient le salon suffit à déduire la catégorie de ticket :
// chaque entrée de `config.tickets` déclare le `categoryId` dans lequel ses tickets sont créés.
function findTicketConfigByChannelCategory(tickets, parentId) {
    if (!parentId) return null;
    return (tickets ?? []).find(ticket => ticket.categoryId === parentId) ?? null;
}

module.exports = {
    CONTROLS_MARKER_CUSTOM_ID,
    findTicketConfigByChannelCategory,
    findTicketControlsMessage,
    isTicketControlsMessage
};
