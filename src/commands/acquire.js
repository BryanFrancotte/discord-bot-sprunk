'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { canManageBot } = require('../utils/permissions');
const { findTicketConfigByChannelCategory } = require('../utils/ticketMessages');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acquire')
        .setDescription('Transformer ce salon en ticket géré par le bot')
        .addUserOption(option => option
            .setName('proprietaire')
            .setDescription('Membre propriétaire du ticket (par défaut : vous)')
            .setRequired(false))
        .addBooleanOption(option => option
            .setName('silencieux')
            .setDescription('Acquérir sans menu (catégorie déduite du salon) et sans mentionner personne')
            .setRequired(false)),

    async execute(client, interaction) {
        if (!canManageBot(interaction.member, client.config)) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.channel?.isTextBased()) {
            return interaction.reply({
                content: '❌ Cette commande ne peut pas être utilisée ici.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (client.services.tickets.parseTopic(interaction.channel.topic)) {
            return interaction.reply({
                content: '❌ Ce salon est déjà un ticket géré par le bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        const owner = interaction.options.getUser('proprietaire') ?? interaction.user;
        if (owner.bot) {
            return interaction.reply({ content: '❌ Le propriétaire ne peut pas être un bot.', flags: MessageFlags.Ephemeral });
        }

        const silent = interaction.options.getBoolean('silencieux') ?? false;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // En mode silencieux, la catégorie Discord du salon suffit à déduire la catégorie du ticket :
        // on n'affiche le menu que si aucune catégorie de `config.json` ne correspond.
        if (silent) {
            const ticketConfig = findTicketConfigByChannelCategory(client.config.tickets, interaction.channel.parentId);
            if (ticketConfig) {
                return client.services.tickets.acquireChannel(interaction, ticketConfig.id, owner.id, {
                    silent: true,
                    deferred: true
                });
            }
        }

        await client.services.tickets.showAcquireCategoryMenu(interaction, owner.id, { silent });
    }
};
