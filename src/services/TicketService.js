'use strict';

const {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} = require('discord.js');
const { canManageBot } = require('../utils/permissions');
const { getDisplayName, sanitizeChannelName } = require('../utils/text');
const { isDiscordId } = require('../utils/config');

const OWNER_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks
];

const STAFF_PERMISSIONS = [
    ...OWNER_PERMISSIONS,
    PermissionFlagsBits.ManageMessages
];

class TicketService {
    constructor(client, ticketLogService, discordLogService) {
        this.client = client;
        this.ticketLogService = ticketLogService;
        this.discordLogService = discordLogService;
        this.closingTickets = new Set();
    }

    async sendPanel(channel) {
        if (!channel?.isTextBased() || typeof channel.send !== 'function') {
            throw new Error('Ce salon ne permet pas l’envoi du panel.');
        }

        const embed = new EmbedBuilder()
            .setTitle('🥤 SPRUNK | HUB DE SUPPORT')
            .setDescription('Besoin d’assistance ? Cliquez ci-dessous.')
            .setColor(this.client.config.bot.color)
            .setFooter({ text: this.client.config.bot.footerText });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket:open')
                .setLabel('Ouvrir un ticket')
                .setEmoji('🎫')
                .setStyle(ButtonStyle.Success)
        );

        return channel.send({ embeds: [embed], components: [row] });
    }

    async showCategoryMenu(interaction) {
        const options = this.client.config.tickets.map(ticket => {
            const option = {
                label: ticket.label.slice(0, 100),
                value: ticket.id,
                description: (ticket.details || 'Cliquez pour ouvrir').slice(0, 100)
            };
            if (ticket.emoji?.trim()) option.emoji = ticket.emoji.trim();
            return option;
        });

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticket:category')
                .setPlaceholder('Sélectionnez une catégorie…')
                .addOptions(options)
        );

        await interaction.reply({
            content: 'Sélectionnez votre catégorie :',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    async createTicket(interaction, categoryId) {
        const ticketConfig = this.client.config.tickets.find(ticket => ticket.id === categoryId);
        if (!ticketConfig) {
            await interaction.update({ content: 'Categorie introuvable.', components: [] });
            return;
        }
        if (this.needsArchitectureQuestionnaire(ticketConfig)) {
            await this.showArchitectureQuestionnaire(interaction);
            return;
        }

        await interaction.deferUpdate();

        if (!isDiscordId(ticketConfig.staffRoleId)) {
            return interaction.editReply({
                content: '❌ Le rôle staff de cette catégorie est mal configuré.',
                components: []
            });
        }

        const displayName = getDisplayName(interaction.member, interaction.user);
        const channelName = sanitizeChannelName(`ticket-${displayName}-${ticketConfig.id}`);
        const permissionOverwrites = [
            {
                id: interaction.guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: OWNER_PERMISSIONS
            },
            {
                id: ticketConfig.staffRoleId,
                allow: STAFF_PERMISSIONS
            },
            {
                id: this.client.user.id,
                allow: [
                    ...STAFF_PERMISSIONS,
                    PermissionFlagsBits.ManageChannels
                ]
            }
        ];

        const channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            topic: this.buildTopic(interaction.user.id, ticketConfig.id),
            parent: isDiscordId(ticketConfig.categoryId) ? ticketConfig.categoryId : undefined,
            permissionOverwrites,
            reason: `Ticket ouvert par ${interaction.user.tag}`
        });

        const logEmbed = new EmbedBuilder()
            .setTitle('📥 TICKET OUVERT')
            .setColor(this.client.config.bot.color)
            .setDescription([
                `Ouvert par : **${displayName}** (${interaction.user.tag})`,
                `Catégorie : **${ticketConfig.label}**`,
                `Salon : ${channel}`
            ].join('\n'))
            .setTimestamp();
        await this.discordLogService.send(interaction.guild, logEmbed);

        const ticketEmbed = new EmbedBuilder()
            .setTitle(ticketConfig.title)
            .setDescription([
                ticketConfig.description.replace('{user}', `${interaction.user}`),
                '',
                '**Informations :**',
                `**Utilisateur :** ${displayName}`,
                `**Détails :** ${ticketConfig.details || 'N/A'}`
            ].join('\n'))
            .setColor(this.client.config.bot.color);

        const controls = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket:close')
                .setLabel('Fermer')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket:reassign')
                .setLabel('Réassigner')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket:rename')
                .setLabel('Renommer')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('ticket:add-user')
                .setLabel('Ajouter')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('ticket:remove-user')
                .setLabel('Retirer')
                .setEmoji('➖')
                .setStyle(ButtonStyle.Secondary)
        );

        await channel.send({
            content: `${interaction.user} | <@&${ticketConfig.staffRoleId}>`,
            embeds: [ticketEmbed],
            components: [controls],
            allowedMentions: {
                users: [interaction.user.id],
                roles: [ticketConfig.staffRoleId]
            }
        });

        await interaction.editReply({ content: `✅ Ticket créé : ${channel}`, components: [] });
    }

    async showArchitectureQuestionnaire(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('ticket:architecture-confirm')
            .setTitle('Questionnaire Architecture')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('architecture-type')
                        .setLabel('Quel type d architecture souhaitez-vous ?')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Ex : Interieur, Exterieur, Commercial...')
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('architecture-event-date')
                        .setLabel('Quand est votre evenement ?')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Ex : 15/08/2026 ou Dans 2 semaines')
                        .setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('architecture-partners')
                        .setLabel('Combien de partenaires y a-t-il ?')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('Ex : 3')
                        .setRequired(true)
                )
            );

        await interaction.showModal(modal);
    }

    async createArchitectureTicket(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const ticketConfig = this.client.config.tickets.find(ticket => this.needsArchitectureQuestionnaire(ticket));
        if (!ticketConfig) {
            return interaction.editReply('La categorie Architecture n est plus configuree.');
        }
        if (!isDiscordId(ticketConfig.staffRoleId)) {
            return interaction.editReply({
                content: 'Le role staff de cette categorie est mal configure.',
                components: []
            });
        }

        const displayName = getDisplayName(interaction.member, interaction.user);
        const channelName = sanitizeChannelName(`ticket-${displayName}-${ticketConfig.id}`);
        const channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            topic: this.buildTopic(interaction.user.id, ticketConfig.id),
            parent: isDiscordId(ticketConfig.categoryId) ? ticketConfig.categoryId : undefined,
            permissionOverwrites: [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: OWNER_PERMISSIONS
                },
                {
                    id: ticketConfig.staffRoleId,
                    allow: STAFF_PERMISSIONS
                },
                {
                    id: this.client.user.id,
                    allow: [
                        ...STAFF_PERMISSIONS,
                        PermissionFlagsBits.ManageChannels
                    ]
                }
            ],
            reason: `Ticket ouvert par ${interaction.user.tag}`
        });

        const logEmbed = new EmbedBuilder()
            .setTitle('TICKET OUVERT')
            .setColor(this.client.config.bot.color)
            .setDescription([
                `Ouvert par : **${displayName}** (${interaction.user.tag})`,
                `Categorie : **${ticketConfig.label}**`,
                `Salon : ${channel}`
            ].join('\n'))
            .setTimestamp();
        await this.discordLogService.send(interaction.guild, logEmbed);

        const questionnaire = [
            ['Type d architecture', interaction.fields.getTextInputValue('architecture-type')],
            ['Date de l evenement', interaction.fields.getTextInputValue('architecture-event-date')],
            ['Nombre de partenaires', interaction.fields.getTextInputValue('architecture-partners')]
        ];

        const ticketEmbed = new EmbedBuilder()
            .setTitle(ticketConfig.title)
            .setDescription([
                ticketConfig.description.replace('{user}', `${interaction.user}`),
                '',
                '**Informations :**',
                `**Utilisateur :** ${displayName}`,
                '',
                '**Questionnaire :**',
                ...questionnaire.map(([label, value]) => `**${label} :** ${value}`)
            ].join('\n'))
            .setColor(this.client.config.bot.color);

        const controls = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket:close')
                .setLabel('Fermer')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('ticket:reassign')
                .setLabel('Reassigner')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('ticket:rename')
                .setLabel('Renommer')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('ticket:add-user')
                .setLabel('Ajouter')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('ticket:remove-user')
                .setLabel('Retirer')
                .setEmoji('➖')
                .setStyle(ButtonStyle.Secondary)
        );

        await channel.send({
            content: `${interaction.user} | <@&${ticketConfig.staffRoleId}>`,
            embeds: [ticketEmbed],
            components: [controls],
            allowedMentions: {
                users: [interaction.user.id],
                roles: [ticketConfig.staffRoleId]
            }
        });

        await interaction.editReply({ content: `Ticket cree : ${channel}` });
    }

    needsArchitectureQuestionnaire(ticketConfig) {
        return ticketConfig?.id?.toLowerCase() === 'architecture';
    }

    async closeTicket(interaction) {
        if (this.closingTickets.has(interaction.channelId)) {
            return interaction.reply({
                content: '⏳ Ce ticket est déjà en cours de fermeture.',
                flags: MessageFlags.Ephemeral
            });
        }

        this.closingTickets.add(interaction.channelId);
        await interaction.deferReply();
        try {
            const channel = interaction.channel;
            const metadata = this.parseTopic(channel.topic);
            if (!metadata) {
                return interaction.editReply('❌ Ce salon n’est pas un ticket géré par le bot.');
            }

            await interaction.editReply('⏳ Fermeture du ticket et génération du transcript…');
            const messages = await this.fetchTranscriptMessages(channel);
            const transcript = this.buildTranscript(channel, messages);
            const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), {
                name: `transcript-${sanitizeChannelName(channel.name)}.txt`
            });
            const displayName = getDisplayName(interaction.member, interaction.user);

            const logEntry = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                channelId: channel.id,
                channelName: channel.name,
                category: metadata.categoryId,
                ownerId: metadata.ownerId,
                closedBy: displayName,
                closedById: interaction.user.id,
                closedByTag: interaction.user.tag,
                closedAt: new Date().toISOString(),
                messages: messages.map(message => ({
                    ts: message.createdAt.toISOString(),
                    author: message.author.tag,
                    authorId: message.author.id,
                    content: message.content,
                    attachments: [...message.attachments.values()].map(item => item.url),
                    avatarURL: message.author.displayAvatarURL()
                }))
            };

            // La sauvegarde JSON est obligatoire avant de supprimer le salon.
            await this.ticketLogService.add(logEntry);

            const logEmbed = new EmbedBuilder()
                .setTitle('📤 TICKET FERMÉ')
                .setColor(this.client.config.bot.color)
                .setDescription(`Par **${displayName}**\nSalon : ${channel.name}`)
                .setTimestamp();
            await this.sendClosedTicketLog(interaction.guild, logEmbed, attachment);

            await interaction.editReply('✅ Ticket archivé. Suppression du salon…');
            const deleteDelay = Math.max(0, Number(this.client.config.ticketsSettings?.deleteDelayMs) || 2000);
            const timer = setTimeout(() => channel.delete('Ticket fermé').catch(error => {
                console.error('Suppression du ticket impossible :', error.message);
                this.closingTickets.delete(interaction.channelId);
            }), deleteDelay);
            timer.unref?.();
        } catch (error) {
            this.closingTickets.delete(interaction.channelId);
            throw error;
        }
    }

    async showReassignMenu(interaction) {
        if (!canManageBot(interaction.member, this.client.config)) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticket:reassign-confirm')
                .setPlaceholder('Réassigner vers…')
                .addOptions(this.client.config.tickets.map(ticket => ({
                    label: ticket.label.slice(0, 100),
                    value: ticket.id,
                    description: 'Transférer le dossier'
                })))
        );

        await interaction.reply({
            content: 'Choisissez la nouvelle équipe :',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    async reassignTicket(interaction, categoryId) {
        if (!canManageBot(interaction.member, this.client.config)) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferUpdate();
        const target = this.client.config.tickets.find(ticket => ticket.id === categoryId);
        const metadata = this.parseTopic(interaction.channel.topic);
        if (!target || !metadata || !isDiscordId(target.staffRoleId)) {
            return interaction.followUp({
                content: '❌ Catégorie ou ticket invalide.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (isDiscordId(target.categoryId)) {
            await interaction.channel.setParent(target.categoryId, {
                lockPermissions: false,
                reason: `Ticket réassigné par ${interaction.user.tag}`
            });
        }

        const obsoleteStaffRoleIds = new Set(
            this.client.config.tickets
                .map(ticket => ticket.staffRoleId)
                .filter(roleId => isDiscordId(roleId) && roleId !== target.staffRoleId)
        );
        for (const roleId of obsoleteStaffRoleIds) {
            if (interaction.channel.permissionOverwrites.cache.has(roleId)) {
                await interaction.channel.permissionOverwrites.delete(roleId).catch(() => undefined);
            }
        }

        await interaction.channel.permissionOverwrites.edit(metadata.ownerId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true
        });
        await interaction.channel.permissionOverwrites.edit(target.staffRoleId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
            ManageMessages: true
        });
        await interaction.channel.setTopic(this.buildTopic(metadata.ownerId, target.id));

        const embed = new EmbedBuilder()
            .setTitle('🔁 RÉASSIGNATION')
            .setColor('#fbc531')
            .setDescription(`Dossier transféré à **${target.label}** par ${interaction.user}.`);
        await interaction.channel.send({
            content: `<@&${target.staffRoleId}>`,
            embeds: [embed],
            allowedMentions: { roles: [target.staffRoleId] }
        });
        await interaction.followUp({
            content: '✅ Ticket réassigné avec succès.',
            flags: MessageFlags.Ephemeral
        });
    }

    async showRenameModal(interaction) {
        if (!canManageBot(interaction.member, this.client.config)) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        const modal = new ModalBuilder()
            .setCustomId('ticket:rename-confirm')
            .setTitle('Renommer le ticket')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('new-name')
                        .setLabel('Nouveau nom du salon')
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(100)
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder(interaction.channel.name)
                )
            );
        await interaction.showModal(modal);
    }

    async renameTicket(interaction) {
        if (!canManageBot(interaction.member, this.client.config)) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        const metadata = this.parseTopic(interaction.channel.topic);
        if (!metadata) {
            return interaction.reply({
                content: '❌ Ce salon n’est pas un ticket géré par le bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        const oldName = interaction.channel.name;
        const newName = sanitizeChannelName(interaction.fields.getTextInputValue('new-name'));
        await interaction.channel.setName(newName, `Ticket renommé par ${interaction.user.tag}`);
        await interaction.reply({
            content: `✅ Ticket renommé en **${newName}** (ancien nom : ${oldName}).`,
            flags: MessageFlags.Ephemeral
        });

        const embed = new EmbedBuilder()
            .setTitle('✏️ TICKET RENOMMÉ')
            .setColor('#3498db')
            .setDescription([
                `Par : **${getDisplayName(interaction.member, interaction.user)}**`,
                `Ancien nom : **${oldName}**`,
                `Nouveau nom : **${newName}**`
            ].join('\n'))
            .setTimestamp();
        await this.discordLogService.send(interaction.guild, embed);
    }

    async showAddUserMenu(interaction) {
        if (!canManageBot(interaction.member, this.client.config)) {
            return interaction.reply({ content: 'Non autorise.', flags: MessageFlags.Ephemeral });
        }
        if (!this.parseTopic(interaction.channel.topic)) {
            return interaction.reply({
                content: 'Ce salon n est pas un ticket gere par le bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('ticket:add-user-confirm')
                .setPlaceholder('Selectionnez un ou plusieurs utilisateurs...')
                .setMinValues(1)
                .setMaxValues(5)
        );

        await interaction.reply({
            content: 'Choisissez qui ajouter au ticket :',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    async showRemoveUserMenu(interaction) {
        if (!canManageBot(interaction.member, this.client.config)) {
            return interaction.reply({ content: 'Non autorise.', flags: MessageFlags.Ephemeral });
        }
        if (!this.parseTopic(interaction.channel.topic)) {
            return interaction.reply({
                content: 'Ce salon n est pas un ticket gere par le bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId('ticket:remove-user-confirm')
                .setPlaceholder('Selectionnez un ou plusieurs utilisateurs...')
                .setMinValues(1)
                .setMaxValues(5)
        );

        await interaction.reply({
            content: 'Choisissez qui retirer du ticket :',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    async addUsersToTicket(interaction, userIds) {
        if (!canManageBot(interaction.member, this.client.config)) {
            return interaction.reply({ content: 'Non autorise.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferUpdate();
        if (!this.parseTopic(interaction.channel.topic)) {
            return interaction.followUp({
                content: 'Ce salon n est pas un ticket gere par le bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        for (const userId of userIds) {
            await interaction.channel.permissionOverwrites.edit(userId, {
                ViewChannel: true,
                SendMessages: true,
                AttachFiles: true,
                ReadMessageHistory: true,
                EmbedLinks: true
            });
        }

        await interaction.channel.send({
            embeds: [new EmbedBuilder()
                .setTitle('MEMBRE AJOUTE')
                .setColor(this.client.config.bot.color)
                .setDescription(`Les utilisateurs suivants ont ete ajoutes par ${interaction.user} :\n${userIds.map(id => `<@${id}>`).join('\n')}`)
                .setTimestamp()]
        });
        await interaction.followUp({
            content: 'Utilisateurs ajoutes avec succes.',
            flags: MessageFlags.Ephemeral
        });
    }

    async removeUsersFromTicket(interaction, userIds) {
        if (!canManageBot(interaction.member, this.client.config)) {
            return interaction.reply({ content: 'Non autorise.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferUpdate();
        const metadata = this.parseTopic(interaction.channel.topic);
        if (!metadata) {
            return interaction.followUp({
                content: 'Ce salon n est pas un ticket gere par le bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        const removableUserIds = userIds.filter(userId => (
            userId !== metadata.ownerId &&
            userId !== this.client.user.id
        ));
        for (const userId of removableUserIds) {
            await interaction.channel.permissionOverwrites.delete(userId);
        }

        if (removableUserIds.length > 0) {
            await interaction.channel.send({
                embeds: [new EmbedBuilder()
                    .setTitle('MEMBRE RETIRE')
                    .setColor('#e74c3c')
                    .setDescription(`Les utilisateurs suivants ont ete retires par ${interaction.user} :\n${removableUserIds.map(id => `<@${id}>`).join('\n')}`)
                    .setTimestamp()]
            });
        }

        await interaction.followUp({
            content: removableUserIds.length > 0
                ? 'Utilisateurs retires avec succes.'
                : 'Aucun utilisateur selectionne ne peut etre retire.',
            flags: MessageFlags.Ephemeral
        });
    }

    buildTopic(ownerId, categoryId) {
        return `sprunk-ticket|owner=${ownerId}|category=${categoryId}`;
    }

    parseTopic(topic) {
        const match = /^sprunk-ticket\|owner=(\d{17,20})\|category=([a-zA-Z0-9_-]+)$/.exec(topic || '');
        if (!match) return null;
        return { ownerId: match[1], categoryId: match[2] };
    }

    async fetchTranscriptMessages(channel) {
        const configuredLimit = Number(this.client.config.ticketsSettings?.transcriptMessageLimit) || 1000;
        const limit = Math.min(5000, Math.max(1, configuredLimit));
        const messages = [];
        let before;

        while (messages.length < limit) {
            const batch = await channel.messages.fetch({
                limit: Math.min(100, limit - messages.length),
                ...(before ? { before } : {})
            });
            if (batch.size === 0) break;
            const values = [...batch.values()];
            messages.push(...values);
            before = values.at(-1).id;
            if (batch.size < 100) break;
        }

        return messages.sort((left, right) => left.createdTimestamp - right.createdTimestamp);
    }

    buildTranscript(channel, messages) {
        const lines = [`TRANSCRIPT SPRUNK - #${channel.name}`, ''];
        for (const message of messages) {
            const attachments = [...message.attachments.values()].map(item => item.url);
            const content = [message.content || '[message sans texte]', ...attachments].join(' ');
            lines.push(`[${message.createdAt.toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}] ${message.author.tag}: ${content}`);
        }
        return `${lines.join('\n')}\n`;
    }

    buildTranscriptPreview(transcript) {
        const prefix = '```txt\n';
        const suffix = '\n```';
        const truncation = '\n...';
        const maxBodyLength = 2000 - prefix.length - suffix.length;

        let body = transcript.trimEnd();
        if (body.length > maxBodyLength) {
            body = `${body.slice(0, maxBodyLength - truncation.length)}${truncation}`;
        }

        return `${prefix}${body}${suffix}`;
    }

    async sendClosedTicketLog(guild, embed, attachment) {
        const channelId = this.client.config.ticketsSettings?.closeLogsChannelId;
        if (!isDiscordId(channelId)) return false;

        try {
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel?.isTextBased() || typeof channel.send !== 'function') return false;

            await channel.send({
                files: [attachment],
                embeds: [embed]
            });
            return true;
        } catch (error) {
            if (![50001, 50013, 10003].includes(error.code)) {
                console.error('Envoi du log de fermeture impossible :', error.message);
            }
            return false;
        }
    }
}

module.exports = TicketService;
