'use strict';

const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { isDiscordId } = require('../utils/config');
const { RenameLimiter, formatRenameLimitMessage } = require('../utils/renameLimiter');
const { getDisplayName, toTextChannelName } = require('../utils/text');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

const STATES = {
    open: { label: 'Ouvert', color: '#2ecc71' },
    closed: { label: 'Fermé', color: '#e74c3c' }
};

class StatusService {
    constructor(client, discordLogService) {
        this.client = client;
        this.discordLogService = discordLogService;
        this.renameLimiter = new RenameLimiter();
    }

    resolveStatus(state, overrides = {}) {
        const definition = STATES[state];
        if (!definition) return { error: '❌ État inconnu.' };

        const preset = this.client.config.status?.[state] ?? {};
        const channelName = toTextChannelName(overrides.channelName?.trim() || preset.channelName);
        const message = String(overrides.message?.trim() || preset.message || '').trim();

        if (!channelName || !message) {
            return {
                error: `❌ Aucun nom de salon ou message prédéfini pour « ${definition.label} » (status.${state} dans config.json). Renseignez les options nom et message, ou complétez config.json.`
            };
        }
        if (message.length > 4096) {
            return { error: '❌ Le message dépasse la limite Discord de 4096 caractères.' };
        }

        return {
            state,
            label: definition.label,
            color: definition.color,
            channelName,
            message,
            image: String(preset.image || '').trim() || null
        };
    }

    getRenameRetryDelay(channelId, now = Date.now()) {
        return this.renameLimiter.getRetryDelay(channelId, now);
    }

    recordRename(channelId, now = Date.now()) {
        this.renameLimiter.record(channelId, now);
    }

    resolveImage(status) {
        if (!status.image) return null;
        if (/^https?:\/\//i.test(status.image)) return { url: status.image };

        const filePath = path.resolve(PROJECT_ROOT, status.image);
        if (!fs.existsSync(filePath)) return { missing: status.image };

        const extension = path.extname(filePath).toLowerCase() || '.png';
        return {
            attachment: new AttachmentBuilder(filePath, { name: `statut-${status.state}${extension}` })
        };
    }

    buildStatusPayload(status, ping = true) {
        const embed = new EmbedBuilder()
            .setDescription(status.message)
            .setColor(status.color)
            .setFooter({ text: this.client.config.bot.footerText })
            .setTimestamp();

        const image = this.resolveImage(status);
        if (image?.url) embed.setImage(image.url);
        if (image?.attachment) embed.setImage(`attachment://${image.attachment.name}`);

        const roleId = this.client.config.status?.notificationRoleId;
        const mentionedRoleId = ping && isDiscordId(roleId) ? roleId : null;

        const payload = {
            embeds: [embed],
            files: image?.attachment ? [image.attachment] : [],
            // parse: [] neutralise un @everyone qui viendrait du message configuré.
            allowedMentions: { parse: [], roles: mentionedRoleId ? [mentionedRoleId] : [] }
        };
        if (mentionedRoleId) payload.content = `<@&${mentionedRoleId}>`;

        return { payload, missingImage: image?.missing ?? null };
    }

    async updateStatus(interaction, state, overrides = {}) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const status = this.resolveStatus(state, overrides);
        if (status.error) return interaction.editReply(status.error);

        const channelId = this.client.config.status?.channelId;
        if (!isDiscordId(channelId)) {
            return interaction.editReply('❌ Le salon de statut n’est pas configuré (status.channelId dans config.json).');
        }

        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased() || typeof channel.send !== 'function') {
            return interaction.editReply('❌ Le salon de statut est introuvable ou ne permet pas l’envoi de messages.');
        }

        const needsRename = channel.name !== status.channelName;
        if (needsRename) {
            const retryDelay = this.getRenameRetryDelay(channel.id);
            if (retryDelay > 0) {
                return interaction.editReply(formatRenameLimitMessage(retryDelay));
            }
            await channel.setName(status.channelName, `Statut « ${status.label} » défini par ${interaction.user.tag}`);
            this.recordRename(channel.id);
        }

        const { payload, missingImage } = this.buildStatusPayload(status, overrides.ping !== false);
        // Un message modifié ne notifie personne : le panneau est republié, puis l’ancien est retiré.
        const previousMessage = (await channel.messages.fetch({ limit: 1 })).first();
        await channel.send(payload);
        if (previousMessage?.author?.id === this.client.user.id && previousMessage.embeds?.length > 0) {
            await previousMessage.delete().catch(() => undefined);
        }

        await interaction.editReply([
            `✅ Statut **${status.label}** affiché dans ${channel}` +
                (needsRename ? ` (salon renommé en **${status.channelName}**).` : '.'),
            missingImage ? `⚠️ Image introuvable : \`${missingImage}\` — message publié sans image.` : null
        ].filter(Boolean).join('\n'));

        const logEmbed = new EmbedBuilder()
            .setTitle('🪧 STATUT MIS À JOUR')
            .setColor(status.color)
            .setDescription([
                `Par : **${getDisplayName(interaction.member, interaction.user)}**`,
                `État : **${status.label}**`,
                `Salon : ${channel}`
            ].join('\n'))
            .setTimestamp();
        await this.discordLogService.send(interaction.guild, logEmbed);
    }
}

module.exports = StatusService;
