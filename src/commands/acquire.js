'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { canManageBot } = require('../utils/permissions');
const { findTicketConfigByChannelCategory } = require('../utils/ticketMessages');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acquire')
        .setDescription('Transformer ce salon en ticket géré par le bot (ou mettre à jour un ticket existant)')
        .addUserOption(option => option
            .setName('proprietaire')
            .setDescription('Membre propriétaire du ticket (par défaut : le propriétaire actuel, sinon vous)')
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

        // Sur un salon déjà géré par le bot, la commande sert à rafraîchir le ticket :
        // le propriétaire et la catégorie actuels servent alors de valeurs par défaut.
        const metadata = client.services.tickets.parseTopic(interaction.channel.topic);

        const chosenOwner = interaction.options.getUser('proprietaire');
        if (chosenOwner?.bot) {
            return interaction.reply({ content: '❌ Le propriétaire ne peut pas être un bot.', flags: MessageFlags.Ephemeral });
        }
        // Le propriétaire d'un ticket existant est conservé tel quel : son ID suffit, inutile de
        // le résoudre auprès de Discord (il a pu quitter le serveur depuis).
        const ownerId = chosenOwner?.id ?? metadata?.ownerId ?? interaction.user.id;

        const silent = interaction.options.getBoolean('silencieux') ?? false;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // En mode silencieux, la catégorie actuelle du ticket (ou à défaut la catégorie Discord du salon)
        // suffit à déduire la catégorie : on n'affiche le menu que si aucune ne correspond à `config.json`.
        if (silent) {
            const ticketConfig = client.config.tickets.find(ticket => ticket.id === metadata?.categoryId)
                ?? findTicketConfigByChannelCategory(client.config.tickets, interaction.channel.parentId);
            if (ticketConfig) {
                return client.services.tickets.acquireChannel(interaction, ticketConfig.id, ownerId, {
                    silent: true,
                    deferred: true
                });
            }
        }

        await client.services.tickets.showAcquireCategoryMenu(interaction, ownerId, { silent });
    }
};
