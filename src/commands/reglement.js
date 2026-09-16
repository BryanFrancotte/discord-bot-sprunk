'use strict';

const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { isAdministrator } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reglement')
        .setDescription('Publier le règlement avec le bouton d’acceptation')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(client, interaction) {
        if (!isAdministrator(interaction.member)) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        await client.services.rules.sendRules(interaction.channel);
        await interaction.reply({
            content: '✅ Règlement publié.',
            flags: MessageFlags.Ephemeral
        });
    }
};
