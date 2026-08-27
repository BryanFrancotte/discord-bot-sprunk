'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { isAdministrator } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('template')
        .setDescription('Afficher le panel des tickets')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(client, interaction) {
        if (!isAdministrator(interaction.member)) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        await client.services.tickets.sendPanel(interaction.channel);
        await interaction.reply({
            content: '✅ Panel des tickets envoyé avec succès.',
            flags: MessageFlags.Ephemeral
        });
    }
};
