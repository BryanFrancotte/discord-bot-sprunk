'use strict';

const {
    ActionRowBuilder,
    EmbedBuilder,
    MessageFlags,
    StringSelectMenuBuilder
} = require('discord.js');
const { canManageBot, hasRole } = require('../utils/permissions');
const { getDisplayName } = require('../utils/text');
const {
    STATUS_KEYS,
    buildChannelName,
    canChangeStatus,
    findStatusByEmoji,
    getAssignmentConfig,
    resolveAssignee,
    splitChannelName
} = require('../utils/ticketAssignment');

const NOT_A_TICKET = '❌ Ce salon n’est pas un ticket géré par le bot.';
const NOT_AVAILABLE = '❌ L’assignation n’est pas disponible pour cette catégorie.';

class TicketAssignmentService {
    constructor(client, ticketService, discordLogService) {
        this.client = client;
        this.ticketService = ticketService;
        this.discordLogService = discordLogService;
    }

    getTicketContext(channel) {
        const metadata = this.ticketService.parseTopic(channel?.topic);
        if (!metadata) return { error: NOT_A_TICKET };

        const ticketConfig = this.client.config.tickets.find(ticket => ticket.id === metadata.categoryId);
        const assignment = getAssignmentConfig(ticketConfig);
        if (!assignment) return { error: NOT_AVAILABLE };

        return { metadata, ticketConfig, assignment };
    }

    // Un choix dans un menu éphémère remplace ce menu ; un bouton ou une commande ouvre une réponse éphémère.
    async deferEphemeral(interaction) {
        if (interaction.isStringSelectMenu?.()) {
            await interaction.deferUpdate();
        } else {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
    }

    async showAssignMenu(interaction) {
        const context = this.getTicketContext(interaction.channel);
        if (context.error) {
            return interaction.reply({ content: context.error, flags: MessageFlags.Ephemeral });
        }

        const { ticketConfig, assignment } = context;
        if (!canManageBot(interaction.member, this.client.config)) {
            if (hasRole(interaction.member, ticketConfig.staffRoleId)) {
                return this.assignTicket(interaction, interaction.user.id);
            }
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        await interaction.guild.members.fetch();
        const role = interaction.guild.roles.cache.get(ticketConfig.staffRoleId);
        const architects = [...(role?.members.values() ?? [])]
            .filter(member => assignment.architects[member.id])
            .slice(0, 25);

        if (architects.length === 0) {
            return interaction.reply({
                content: '❌ Aucun membre du rôle architecte n’a d’emoji configuré (tickets[].assignment.architects dans config.json).',
                flags: MessageFlags.Ephemeral
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticket:assign-confirm')
                .setPlaceholder('Choisissez un architecte…')
                .addOptions(architects.map(member => ({
                    label: `${assignment.architects[member.id]} ${getDisplayName(member, member.user)}`.slice(0, 100),
                    value: member.id
                })))
        );

        await interaction.reply({
            content: 'À quel architecte assigner ce ticket ?',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    async assignTicket(interaction, targetUserId) {
        await this.deferEphemeral(interaction);

        const channel = interaction.channel;
        const context = this.getTicketContext(channel);
        if (context.error) return interaction.editReply({ content: context.error, components: [] });

        const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
        const assignee = resolveAssignee(interaction.member, targetMember, context.ticketConfig, this.client.config);
        if (assignee.error) return interaction.editReply({ content: assignee.error, components: [] });

        const { statuses } = context.assignment;
        const current = splitChannelName(channel.name);
        const currentStatus = findStatusByEmoji(context.assignment, current.statusEmoji);
        // Une assignation fait passer le ticket « en cours », sauf s’il est déjà plus avancé (payé, terminé).
        const nextStatus = !currentStatus || currentStatus.key === 'pending' ? statuses.inProgress : currentStatus;
        const newName = buildChannelName({
            architectEmoji: assignee.emoji,
            base: current.base,
            statusEmoji: nextStatus.emoji
        });

        const assignerName = getDisplayName(interaction.member, interaction.user);
        const renamed = await this.ticketService.renameChannel(channel, newName, `Ticket assigné par ${interaction.user.tag}`);
        if (renamed.error) return interaction.editReply({ content: renamed.error, components: [] });

        const architectName = getDisplayName(targetMember, targetMember.user);
        await channel.send({
            content: `${assignee.emoji} Ticket pris en charge par <@${targetMember.id}> — statut : **${nextStatus.emoji} ${nextStatus.label}**.`,
            allowedMentions: { parse: [], users: [targetMember.id] }
        });
        await interaction.editReply({
            content: `✅ Ticket assigné à **${architectName}** (${assignee.emoji}).`,
            components: []
        });

        const logEmbed = new EmbedBuilder()
            .setTitle('📐 TICKET ASSIGNÉ')
            .setColor(this.client.config.bot.color)
            .setDescription([
                `Par : **${assignerName}**`,
                `Architecte : **${architectName}** ${assignee.emoji}`,
                `Statut : ${nextStatus.emoji} ${nextStatus.label}`,
                `Salon : ${channel}`
            ].join('\n'))
            .setTimestamp();
        await this.discordLogService.send(interaction.guild, logEmbed);
    }

    async showStatusMenu(interaction) {
        const context = this.getTicketContext(interaction.channel);
        if (context.error) {
            return interaction.reply({ content: context.error, flags: MessageFlags.Ephemeral });
        }
        if (!canChangeStatus(interaction.member, context.ticketConfig, this.client.config)) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        const currentEmoji = splitChannelName(interaction.channel.name).statusEmoji;
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticket:status-confirm')
                .setPlaceholder('Nouveau statut…')
                .addOptions(STATUS_KEYS.map(key => {
                    const status = context.assignment.statuses[key];
                    return {
                        label: `${status.emoji} ${status.label}`.slice(0, 100),
                        value: key,
                        default: status.emoji === currentEmoji
                    };
                }))
        );

        await interaction.reply({
            content: 'Choisissez le statut du ticket :',
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }

    async setStatus(interaction, statusKey) {
        await this.deferEphemeral(interaction);

        const channel = interaction.channel;
        const context = this.getTicketContext(channel);
        if (context.error) return interaction.editReply({ content: context.error, components: [] });
        if (!canChangeStatus(interaction.member, context.ticketConfig, this.client.config)) {
            return interaction.editReply({ content: '❌ Non autorisé.', components: [] });
        }

        const status = context.assignment.statuses[statusKey];
        if (!status) return interaction.editReply({ content: '❌ Statut inconnu.', components: [] });

        const current = splitChannelName(channel.name);
        const newName = buildChannelName({ ...current, statusEmoji: status.emoji });
        const renamed = await this.ticketService.renameChannel(channel, newName, `Statut changé par ${interaction.user.tag}`);
        if (renamed.error) return interaction.editReply({ content: renamed.error, components: [] });

        const displayName = getDisplayName(interaction.member, interaction.user);
        await channel.send({
            content: `Statut du ticket : **${status.emoji} ${status.label}** (par ${interaction.user}).`,
            allowedMentions: { parse: [] }
        });
        await interaction.editReply({ content: `✅ Statut passé à **${status.emoji} ${status.label}**.`, components: [] });

        const logEmbed = new EmbedBuilder()
            .setTitle('🏷️ STATUT DE TICKET')
            .setColor(this.client.config.bot.color)
            .setDescription([
                `Par : **${displayName}**`,
                `Statut : ${status.emoji} ${status.label}`,
                `Salon : ${channel}`
            ].join('\n'))
            .setTimestamp();
        await this.discordLogService.send(interaction.guild, logEmbed);
    }
}

module.exports = TicketAssignmentService;
