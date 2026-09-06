'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { canManageBot } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acquire')
        .setDescription('Transformer ce salon en ticket géré par le bot')
        .addUserOption(option => option
            .setName('proprietaire')
            .setDescription('Membre propriétaire du ticket')
            .setRequired(true)),

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

        const owner = interaction.options.getUser('proprietaire', true);
        if (owner.bot) {
            return interaction.reply({ content: '❌ Le propriétaire ne peut pas être un bot.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await client.services.tickets.showAcquireCategoryMenu(interaction, owner.id);
    }
};
