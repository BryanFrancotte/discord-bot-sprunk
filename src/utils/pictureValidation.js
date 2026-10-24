'use strict';

const { isDiscordId } = require('./config');
const { canManageBot, hasRole } = require('./permissions');

const PICTURE_CUSTOM_ID_PATTERN = /^picture:(approve|reject|reject-confirm):(\d{17,20}):(\d{17,20})$/;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i;
const MAX_REJECT_REASON_LENGTH = 500;

// La validation des photos n’existe que pour les catégories qui déclarent un bloc `pictureValidation`.
function getPictureValidationConfig(ticketConfig) {
    const block = ticketConfig?.pictureValidation;
    if (!block || typeof block !== 'object' || !isDiscordId(block.threadId)) return null;
    return { threadId: block.threadId };
}

// Discord ne renseigne pas toujours `contentType` (anciens messages, certains clients) : l’extension sert de repli.
function isImageAttachment(attachment) {
    if (attachment?.contentType) return attachment.contentType.startsWith('image/');
    return IMAGE_EXTENSIONS.test(attachment?.name ?? '');
}

// Le salon et le message d’origine voyagent dans le `customId` : aucun état n’est stocké côté bot.
function buildPictureCustomId(action, channelId, messageId) {
    return `picture:${action}:${channelId}:${messageId}`;
}

function parsePictureCustomId(customId) {
    const match = PICTURE_CUSTOM_ID_PATTERN.exec(customId || '');
    if (!match) return null;
    return { action: match[1], channelId: match[2], messageId: match[3] };
}

// Les photos postées par le staff de la catégorie ne partent pas en validation.
function isPictureReviewer(member, ticketConfig, config) {
    return canManageBot(member, config) || hasRole(member, ticketConfig?.staffRoleId);
}

// Le salon du ticket peut avoir été supprimé entre-temps : le droit de décider se lit donc depuis
// le fil, en cherchant les catégories qui y envoient leurs photos.
function canReviewPicturesInThread(member, config, threadId) {
    if (canManageBot(member, config)) return true;
    return config.tickets.some(ticket => (
        getPictureValidationConfig(ticket)?.threadId === threadId &&
        hasRole(member, ticket.staffRoleId)
    ));
}

module.exports = {
    MAX_REJECT_REASON_LENGTH,
    buildPictureCustomId,
    canReviewPicturesInThread,
    getPictureValidationConfig,
    isImageAttachment,
    isPictureReviewer,
    parsePictureCustomId
};
