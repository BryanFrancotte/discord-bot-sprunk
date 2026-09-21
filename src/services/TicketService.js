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
    OverwriteType,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} = require('discord.js');
const { canManageBot } = require('../utils/permissions');
const { getDisplayName, sanitizeChannelName } = require('../utils/text');
const { isDiscordId } = require('../utils/config');
const { RenameLimiter, formatRenameLimitMessage } = require('../utils/renameLimiter');
const { buildChannelName, getAssignmentConfig, splitChannelName } = require('../utils/ticketAssignment');
const { findTicketControlsMessage } = require('../utils/ticketMessages');
const { findObsoleteRoleOverwriteIds, findProbableOwnerId } = require('../utils/ticketPermissions');

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

// Convertit une entrée de permissions (`allow`/`deny` sous forme de bits) en objet
// `{ NomDeLaPermission: true|false }` attendu par `permissionOverwrites.edit`.
function toPermissionOptions(overwrite) {
    const options = {};
    for (const [name, flag] of Object.entries(PermissionFlagsBits)) {
        if (overwrite.allow?.includes(flag)) options[name] = true;
        else if (overwrite.deny?.includes(flag)) options[name] = false;
    }
    return options;
}

class TicketService {
    constructor(client, ticketLogService, discordLogService) {
        this.client = client;
        this.ticketLogService = ticketLogService;
        this.discordLogService = discordLogService;
        this.closingTickets = new Set();
        this.renameLimiter = new RenameLimiter();
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

        const { channel, displayName } = await this.createTicketChannel(interaction, ticketConfig);
        await this.sendTicketChannelMessage(channel, ticketConfig, interaction.user.id, displayName, [
            `**Détails :** ${ticketConfig.details || 'N/A'}`
        ]);

        await interaction.editReply({ content: `✅ Ticket créé : ${channel}`, components: [] });
    }

    async createTicketChannel(interaction, ticketConfig) {
        const displayName = getDisplayName(interaction.member, interaction.user);
        const baseName = sanitizeChannelName(`ticket-${displayName}-${ticketConfig.id}`);
        const assignment = getAssignmentConfig(ticketConfig);
        const channelName = assignment
            ? buildChannelName({ base: baseName, statusEmoji: assignment.statuses.pending.emoji })
            : baseName;

        const channel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            topic: this.buildTopic(interaction.user.id, ticketConfig.id),
            parent: isDiscordId(ticketConfig.categoryId) ? ticketConfig.categoryId : undefined,
            permissionOverwrites: this.buildTicketPermissionOverwrites(interaction, ticketConfig),
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

        return { channel, displayName };
    }

    // Le `type` est toujours explicite : sans lui, discord.js devine rôle ou membre via son cache
    // local, et échoue sur un propriétaire que le bot n'a pas « vu » récemment (ID relu du topic).
    buildTicketPermissionOverwrites(interaction, ticketConfig, ownerId = interaction.user.id) {
        return [
            {
                id: interaction.guild.id,
                type: OverwriteType.Role,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: ownerId,
                type: OverwriteType.Member,
                allow: OWNER_PERMISSIONS
            },
            {
                id: ticketConfig.staffRoleId,
                type: OverwriteType.Role,
                allow: STAFF_PERMISSIONS
            },
            {
                id: this.client.user.id,
                type: OverwriteType.Member,
                allow: [
                    ...STAFF_PERMISSIONS,
                    PermissionFlagsBits.ManageChannels
                ]
            }
        ];
    }

    buildTicketControlsRow() {
        return new ActionRowBuilder().addComponents(
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
    }

    buildAssignmentRow() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('ticket:assign')
                .setLabel('Assigner')
                .setEmoji('📐')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('ticket:status')
                .setLabel('Statut')
                .setEmoji('🏷️')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    buildTicketComponents(ticketConfig) {
        const rows = [this.buildTicketControlsRow()];
        if (getAssignmentConfig(ticketConfig)) rows.push(this.buildAssignmentRow());
        return rows;
    }

    // Renomme un ticket en respectant la limite Discord (2 renommages / 10 min par salon).
    async renameChannel(channel, newName, reason) {
        if (channel.name === newName) return { renamed: false };

        const retryDelay = this.renameLimiter.getRetryDelay(channel.id);
        if (retryDelay > 0) return { error: formatRenameLimitMessage(retryDelay) };

        await channel.setName(newName, reason);
        this.renameLimiter.record(channel.id);
        return { renamed: true };
    }

    // `silent` : message posté sans mention ni notification (mode silencieux de `/acquire`).
    // `reuseExisting` : si le bot a déjà posté un message à boutons dans ce salon, on met celui-là
    // à jour au lieu d'en empiler un second.
    async sendTicketChannelMessage(channel, ticketConfig, ownerId, displayName, extraDescriptionLines, options = {}) {
        const { silent = false, reuseExisting = false } = options;
        const ownerMention = `<@${ownerId}>`;
        const ticketEmbed = new EmbedBuilder()
            .setTitle(ticketConfig.title)
            .setDescription([
                ticketConfig.description.replace('{user}', ownerMention),
                '',
                '**Informations :**',
                `**Utilisateur :** ${displayName}`,
                ...extraDescriptionLines
            ].join('\n'))
            .setColor(this.client.config.bot.color);

        const payload = {
            content: `${ownerMention} | <@&${ticketConfig.staffRoleId}>`,
            embeds: [ticketEmbed],
            components: this.buildTicketComponents(ticketConfig),
            allowedMentions: silent
                ? { parse: [] }
                : { users: [ownerId], roles: [ticketConfig.staffRoleId] }
        };

        const existing = reuseExisting ? await this.findExistingControlsMessage(channel) : null;
        if (existing) return { message: await existing.edit(payload), reused: true };

        const message = await channel.send(silent ? { ...payload, flags: MessageFlags.SuppressNotifications } : payload);
        return { message, reused: false };
    }

    // Cherche dans l'historique récent le message à boutons déjà posté par le bot (null s'il n'y en a pas).
    async findExistingControlsMessage(channel) {
        if (typeof channel?.messages?.fetch !== 'function') return null;
        const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!messages) return null;
        return findTicketControlsMessage(messages.values(), this.client.user?.id);
    }

    buildAcquireCustomId(ownerId, silent = false) {
        return silent ? `ticket:acquire-confirm:${ownerId}:silent` : `ticket:acquire-confirm:${ownerId}`;
    }

    parseAcquireCustomId(customId) {
        const match = /^ticket:acquire-confirm:(\d{17,20})(:silent)?$/.exec(customId || '');
        if (!match) return null;
        return { ownerId: match[1], silent: Boolean(match[2]) };
    }

    // Propriétaire d'un ticket acquis, par ordre de priorité : l'option `proprietaire`, le
    // propriétaire actuel si le salon est déjà un ticket, l'ouvreur déduit des accès individuels
    // du salon, et en dernier recours l'auteur de la commande. `note` annonce à l'auteur une
    // déduction (ou son échec) pour qu'il puisse corriger : elle n'est jamais silencieuse.
    resolveAcquireOwner(interaction, chosenOwnerId, metadata) {
        if (chosenOwnerId) return { ownerId: chosenOwnerId, note: null };
        if (metadata?.ownerId) return { ownerId: metadata.ownerId, note: null };

        const overwrites = interaction.channel?.permissionOverwrites?.cache;
        const excludedIds = [this.client.user.id, interaction.user.id];
        for (const id of overwrites?.keys?.() ?? []) {
            if (this.client.users?.cache?.get(id)?.bot) excludedIds.push(id);
        }

        const deducedOwnerId = findProbableOwnerId(overwrites, excludedIds);
        if (deducedOwnerId) {
            return {
                ownerId: deducedOwnerId,
                note: `ℹ️ Propriétaire déduit des accès du salon : <@${deducedOwnerId}>. Si ce n'est pas le bon, relancez \`/acquire proprietaire:@membre\`.`
            };
        }
        return {
            ownerId: interaction.user.id,
            note: 'ℹ️ Impossible de déduire l\'ouvreur du salon (aucun ou plusieurs membres y ont un accès individuel) : vous êtes enregistré comme propriétaire. Pour corriger, relancez `/acquire proprietaire:@membre`.'
        };
    }

    // `ownerNote` : explication de `resolveAcquireOwner`, affichée au-dessus du menu.
    async showAcquireCategoryMenu(interaction, ownerId, options = {}) {
        const { silent = false, ownerNote = null } = options;
        const menuOptions = this.client.config.tickets.map(ticket => {
            const option = {
                label: ticket.label.slice(0, 100),
                value: ticket.id,
                description: (ticket.details || 'Cliquez pour acquérir').slice(0, 100)
            };
            if (ticket.emoji?.trim()) option.emoji = ticket.emoji.trim();
            return option;
        });

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(this.buildAcquireCustomId(ownerId, silent))
                .setPlaceholder('Sélectionnez une catégorie…')
                .addOptions(menuOptions)
        );

        // Le menu n'apparaît en mode silencieux que si la catégorie Discord du salon n'a pas permis de déduire la catégorie du ticket.
        const prompt = silent
            ? `ℹ️ La catégorie Discord de ce salon ne correspond à aucune catégorie de ticket. Choisissez-la pour <@${ownerId}> :`
            : `Choisissez la catégorie du ticket pour <@${ownerId}> :`;
        const content = [ownerNote, prompt].filter(Boolean).join('\n');

        await interaction.editReply({ content, components: [row] });
    }

    // Acquisition et réassignation : les accès des membres ne sont jamais retirés, ceux des rôles
    // sont alignés sur un ticket créé par le panel.
    // - `permissionOverwrites.edit` ne réécrit que la ligne de l'ID visé, contrairement à `set`
    //   qui remplace la liste entière du salon et éjecterait l'ouvreur et les membres ajoutés ;
    // - le refus `@everyone` de `buildTicketPermissionOverwrites` est volontairement écarté, et
    //   l'overwrite `@everyone` existant est conservé : y toucher changerait la visibilité du salon.
    //   Un salon rangé dans la catégorie Discord du ticket est de toute façon déjà privé par
    //   héritage de la catégorie ;
    // - tout autre overwrite de rôle que le rôle staff de la catégorie est supprimé, **après**
    //   les ajouts pour que le staff et le bot ne perdent jamais l'accès en cours de route.
    //   Les overwrites de membres ne sont jamais supprimés.
    // Retourne les rôles retirés, pour les annoncer au staff et dans le journal.
    async applyTicketPermissions(channel, interaction, ticketConfig, ownerId, reason) {
        const overwrites = this.buildTicketPermissionOverwrites(interaction, ticketConfig, ownerId)
            .filter(overwrite => overwrite.id !== interaction.guild.id);

        for (const overwrite of overwrites) {
            await channel.permissionOverwrites.edit(overwrite.id, toPermissionOptions(overwrite), {
                type: overwrite.type,
                reason
            });
        }

        const removedRoleIds = findObsoleteRoleOverwriteIds(channel.permissionOverwrites.cache, [
            interaction.guild.id,
            ticketConfig.staffRoleId
        ]);
        for (const roleId of removedRoleIds) {
            await channel.permissionOverwrites.delete(roleId, reason);
        }
        return { removedRoleIds };
    }

    // `silent` : pas de menu de catégorie (déduite du salon) et message de ticket sans ping.
    // `deferred` : la réponse éphémère a déjà été différée par la commande appelante.
    // `ownerNote` : explication de `resolveAcquireOwner`, ajoutée à la réponse finale.
    // Sur un salon déjà géré par le bot, l'acquisition devient une mise à jour : permissions,
    // topic et message à boutons sont réécrits au lieu d'être refusés.
    async acquireChannel(interaction, categoryId, ownerId, options = {}) {
        const { silent = false, deferred = false, ownerNote = null } = options;

        if (!canManageBot(interaction.member, this.client.config)) {
            return deferred
                ? interaction.editReply({ content: '❌ Non autorisé.', components: [] })
                : interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        if (!deferred) await interaction.deferUpdate();
        const respond = content => interaction.editReply({ content, components: [] });

        const ticketConfig = this.client.config.tickets.find(ticket => ticket.id === categoryId);
        if (!ticketConfig || !isDiscordId(ticketConfig.staffRoleId)) {
            return respond('❌ Catégorie introuvable ou mal configurée.');
        }

        const channel = interaction.channel;
        const isUpdate = Boolean(this.parseTopic(channel.topic));

        const reason = isUpdate
            ? `Ticket mis à jour par ${interaction.user.tag}`
            : `Salon acquis comme ticket par ${interaction.user.tag}`;
        const { removedRoleIds } = await this.applyTicketPermissions(channel, interaction, ticketConfig, ownerId, reason);
        const removedRolesText = removedRoleIds.map(roleId => `<@&${roleId}>`).join(', ');

        // `setTopic` est limité par Discord : on ne l'appelle que si le topic change réellement.
        const topic = this.buildTopic(ownerId, ticketConfig.id);
        if (channel.topic !== topic) await channel.setTopic(topic, reason);

        const acquiredByName = getDisplayName(interaction.member, interaction.user);
        const ownerMember = await interaction.guild.members.fetch(ownerId).catch(() => null);
        const ownerDisplayName = ownerMember ? getDisplayName(ownerMember, ownerMember.user) : `<@${ownerId}>`;

        const logEmbed = new EmbedBuilder()
            .setTitle(isUpdate ? '♻️ TICKET MIS À JOUR' : '📥 TICKET ACQUIS')
            .setColor(this.client.config.bot.color)
            .setDescription([
                `${isUpdate ? 'Mis à jour' : 'Acquis'} par : **${acquiredByName}** (${interaction.user.tag})`,
                `Propriétaire : <@${ownerId}>`,
                `Catégorie : **${ticketConfig.label}**`,
                silent ? 'Mode : **silencieux**' : null,
                removedRolesText ? `Accès retirés aux rôles : ${removedRolesText}` : null,
                `Salon : ${channel}`
            ].filter(Boolean).join('\n'))
            .setTimestamp();
        await this.discordLogService.send(interaction.guild, logEmbed);

        const { reused } = await this.sendTicketChannelMessage(channel, ticketConfig, ownerId, ownerDisplayName, [
            `**${isUpdate ? 'Mis à jour' : 'Acquis'} par :** ${acquiredByName}`
        ], { silent, reuseExisting: true });

        const summary = isUpdate
            ? `✅ Ticket **${ticketConfig.label}** mis à jour${reused ? '' : ' (aucun message à boutons trouvé : un nouveau a été posté)'}.`
            : `✅ Salon acquis comme ticket **${ticketConfig.label}**${reused ? ' (message à boutons existant mis à jour)' : ''}.`;
        return respond([
            summary,
            removedRolesText ? `🧹 Accès retirés aux rôles : ${removedRolesText}.` : null,
            ownerNote
        ].filter(Boolean).join('\n'));
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

        const { channel, displayName } = await this.createTicketChannel(interaction, ticketConfig);

        const questionnaire = [
            ['Type d architecture', interaction.fields.getTextInputValue('architecture-type')],
            ['Date de l evenement', interaction.fields.getTextInputValue('architecture-event-date')],
            ['Nombre de partenaires', interaction.fields.getTextInputValue('architecture-partners')]
        ];

        await this.sendTicketChannelMessage(channel, ticketConfig, interaction.user.id, displayName, [
            '',
            '**Questionnaire :**',
            ...questionnaire.map(([label, value]) => `**${label} :** ${value}`)
        ]);

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

        const reason = `Ticket réassigné par ${interaction.user.tag}`;
        if (isDiscordId(target.categoryId)) {
            await interaction.channel.setParent(target.categoryId, { lockPermissions: false, reason });
        }

        // Même règle que l'acquisition : aucun membre n'est éjecté (propriétaire, membres ajoutés
        // via « Ajouter »), les rôles sont alignés sur la nouvelle catégorie, `@everyone` n'est pas
        // touché. Les accès sont donnés avant tout retrait : une erreur en cours de route ne peut
        // plus laisser le salon sans personne dedans.
        const { removedRoleIds } = await this.applyTicketPermissions(
            interaction.channel, interaction, target, metadata.ownerId, reason
        );
        await interaction.channel.setTopic(this.buildTopic(metadata.ownerId, target.id), reason);

        const embed = new EmbedBuilder()
            .setTitle('🔁 RÉASSIGNATION')
            .setColor('#fbc531')
            .setDescription(`Dossier transféré à **${target.label}** par ${interaction.user}.`);
        await interaction.channel.send({
            content: `<@&${target.staffRoleId}>`,
            embeds: [embed],
            allowedMentions: { roles: [target.staffRoleId] }
        });
        const removedRolesText = removedRoleIds.map(roleId => `<@&${roleId}>`).join(', ');
        await interaction.followUp({
            content: [
                '✅ Ticket réassigné avec succès.',
                removedRolesText ? `🧹 Accès retirés aux rôles : ${removedRolesText}.` : null
            ].filter(Boolean).join('\n'),
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
        const baseName = sanitizeChannelName(interaction.fields.getTextInputValue('new-name'));
        // Sur un ticket à assignation, les emojis architecte (tête) et statut (fin) sont conservés.
        const ticketConfig = this.client.config.tickets.find(ticket => ticket.id === metadata.categoryId);
        const newName = getAssignmentConfig(ticketConfig)
            ? buildChannelName({ ...splitChannelName(oldName), base: baseName })
            : baseName;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const renamed = await this.renameChannel(interaction.channel, newName, `Ticket renommé par ${interaction.user.tag}`);
        if (renamed.error) return interaction.editReply(renamed.error);

        await interaction.editReply(`✅ Ticket renommé en **${newName}** (ancien nom : ${oldName}).`);

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
