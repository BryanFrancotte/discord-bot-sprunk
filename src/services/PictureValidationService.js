'use strict';

const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { getDisplayName } = require('../utils/text');
const {
    MAX_REJECT_REASON_LENGTH,
    buildPictureCustomId,
    canReviewPicturesInThread,
    getPictureValidationConfig,
    isImageAttachment,
    isPictureReviewer
} = require('../utils/pictureValidation');

const PENDING_EMOJI = '⏳';
const APPROVED_EMOJI = '✅';
const REJECTED_EMOJI = '❌';
const PENDING_COLOR = '#f1c40f';
const APPROVED_COLOR = '#2ecc71';
const REJECTED_COLOR = '#e74c3c';

class PictureValidationService {
    constructor(client, ticketService, discordLogService) {
        this.client = client;
        this.ticketService = ticketService;
        this.discordLogService = discordLogService;
        this.decidingMessages = new Set();
    }

    // Retourne la catégorie de ticket si les images de ce message doivent partir en validation, sinon null.
    resolveSubmission(message) {
        const images = [...message.attachments.values()].filter(isImageAttachment);
        if (images.length === 0) return null;

        const metadata = this.ticketService.parseTopic(message.channel?.topic);
        if (!metadata) return null;

        const ticketConfig = this.client.config.tickets.find(ticket => ticket.id === metadata.categoryId);
        const validation = getPictureValidationConfig(ticketConfig);
        if (!validation || isPictureReviewer(message.member, ticketConfig, this.client.config)) return null;

        return { images, ticketConfig, threadId: validation.threadId };
    }

    async submit(message) {
        const submission = this.resolveSubmission(message);
        if (!submission) return false;

        const thread = await this.client.channels.fetch(submission.threadId).catch(() => null);
        if (!thread?.isTextBased() || typeof thread.send !== 'function') {
            await this.reportMissingThread(message, submission);
            return false;
        }

        const payload = this.buildReviewPayload(message, submission.images);
        // Les fichiers sont ré-envoyés dans le fil : les liens d’origine expirent et disparaissent
        // avec le salon à la fermeture du ticket. Un fichier trop lourd pour le bot retombe sur les liens.
        const files = submission.images.map((image, index) => new AttachmentBuilder(image.url, {
            name: `${index + 1}-${image.name}`
        }));
        try {
            await thread.send({ ...payload, files });
        } catch (error) {
            console.error('Ré-envoi des photos dans le fil impossible, envoi des liens :', error.message);
            await thread.send({ ...payload, content: submission.images.map(image => image.url).join('\n') });
        }

        await message.react(PENDING_EMOJI).catch(() => undefined);
        return true;
    }

    buildReviewPayload(message, images) {
        const displayName = getDisplayName(message.member, message.author);
        const text = message.content?.trim();
        const embed = new EmbedBuilder()
            .setTitle('📸 PHOTO À VALIDER')
            .setColor(PENDING_COLOR)
            .setDescription([
                `**Membre :** ${message.author} (${displayName})`,
                `**Ticket :** ${message.channel}`,
                `**Message :** [voir dans le ticket](${message.url})`,
                `**Photos :** ${images.length}`,
                text ? `**Texte :** ${text.slice(0, 1000)}` : null
            ].filter(Boolean).join('\n'))
            .setTimestamp(message.createdAt);

        return {
            embeds: [embed],
            components: [this.buildReviewRow(message.channelId, message.id)],
            allowedMentions: { parse: [] }
        };
    }

    buildReviewRow(channelId, messageId) {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(buildPictureCustomId('approve', channelId, messageId))
                .setLabel('Valider')
                .setEmoji(APPROVED_EMOJI)
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(buildPictureCustomId('reject', channelId, messageId))
                .setLabel('Refuser')
                .setEmoji(REJECTED_EMOJI)
                .setStyle(ButtonStyle.Danger)
        );
    }

    async reportMissingThread(message, submission) {
        console.error(`Fil de validation des photos introuvable (${submission.threadId}) pour la catégorie ${submission.ticketConfig.id}.`);
        const embed = new EmbedBuilder()
            .setTitle('⚠️ VALIDATION PHOTO IMPOSSIBLE')
            .setColor(REJECTED_COLOR)
            .setDescription([
                `Le fil \`${submission.threadId}\` (tickets[${submission.ticketConfig.id}].pictureValidation.threadId) est introuvable ou inaccessible au bot.`,
                `Photo non transmise : ${message.url}`
            ].join('\n'))
            .setTimestamp();
        await this.discordLogService.send(message.guild, embed);
    }

    async approve(interaction, picture) {
        if (!(await this.ensureReviewer(interaction))) return;
        await this.decide(interaction, picture, { approved: true, reason: null });
    }

    async showRejectModal(interaction, picture) {
        if (!(await this.ensureReviewer(interaction))) return;

        const modal = new ModalBuilder()
            .setCustomId(buildPictureCustomId('reject-confirm', picture.channelId, picture.messageId))
            .setTitle('Refuser la photo')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Motif (visible par le membre)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setMaxLength(MAX_REJECT_REASON_LENGTH)
                        .setRequired(false)
                )
            );
        await interaction.showModal(modal);
    }

    async reject(interaction, picture) {
        if (!(await this.ensureReviewer(interaction))) return;
        const reason = interaction.fields.getTextInputValue('reason')?.trim() || null;
        await this.decide(interaction, picture, { approved: false, reason });
    }

    async ensureReviewer(interaction) {
        if (canReviewPicturesInThread(interaction.member, this.client.config, interaction.channelId)) return true;
        await interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        return false;
    }

    // La demande est d’abord close dans le fil (boutons retirés) puis le membre est prévenu :
    // un double clic ou un second membre du staff ne peut donc pas rendre deux décisions.
    async decide(interaction, picture, decision) {
        const reviewMessage = interaction.message;
        if (this.decidingMessages.has(reviewMessage.id) || reviewMessage.components.length === 0) {
            return interaction.reply({ content: 'ℹ️ Cette photo a déjà été traitée.', flags: MessageFlags.Ephemeral });
        }

        this.decidingMessages.add(reviewMessage.id);
        try {
            const reviewerName = getDisplayName(interaction.member, interaction.user);
            await interaction.update({
                embeds: [this.buildDecisionEmbed(reviewMessage.embeds[0], decision, interaction.user)],
                components: []
            });

            const notified = await this.notifyTicket(picture, decision, reviewerName);
            if (!notified) {
                await interaction.followUp({
                    content: 'ℹ️ Décision enregistrée, mais le ticket est fermé ou le message a été supprimé : le membre n’a pas été prévenu.',
                    flags: MessageFlags.Ephemeral
                });
            }
        } finally {
            this.decidingMessages.delete(reviewMessage.id);
        }
    }

    buildDecisionEmbed(originalEmbed, { approved, reason }, reviewer) {
        const embed = originalEmbed ? EmbedBuilder.from(originalEmbed) : new EmbedBuilder();
        return embed
            .setTitle(approved ? '✅ PHOTO VALIDÉE' : '❌ PHOTO REFUSÉE')
            .setColor(approved ? APPROVED_COLOR : REJECTED_COLOR)
            .addFields(
                { name: 'Décision', value: `${approved ? 'Validée' : 'Refusée'} par ${reviewer}`, inline: true },
                ...(reason ? [{ name: 'Motif', value: reason }] : [])
            );
    }

    buildTicketNotice({ approved, reason }, reviewerName) {
        if (approved) return `${APPROVED_EMOJI} Votre photo a été **validée** par ${reviewerName}.`;
        return [
            `${REJECTED_EMOJI} Votre photo a été **refusée** par ${reviewerName}.`,
            reason ? `**Motif :** ${reason}` : null
        ].filter(Boolean).join('\n');
    }

    async notifyTicket(picture, decision, reviewerName) {
        const channel = await this.client.channels.fetch(picture.channelId).catch(() => null);
        if (!channel?.isTextBased()) return false;

        const original = await channel.messages.fetch(picture.messageId).catch(() => null);
        if (!original) return false;

        await original.reply({
            content: this.buildTicketNotice(decision, reviewerName),
            allowedMentions: { parse: [], repliedUser: true }
        });
        await original.reactions.cache.get(PENDING_EMOJI)?.users.remove(this.client.user.id).catch(() => undefined);
        await original.react(decision.approved ? APPROVED_EMOJI : REJECTED_EMOJI).catch(() => undefined);
        return true;
    }
}

module.exports = PictureValidationService;
