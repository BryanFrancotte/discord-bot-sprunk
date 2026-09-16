'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { canManageBot } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('statut')
        .setDescription('Indiquer si le Sprunk est ouvert ou fermé (nom du salon et message)')
        .addStringOption(option => option
            .setName('etat')
            .setDescription('Ouvert ou fermé')
            .setRequired(true)
            .addChoices(
                { name: 'Ouvert', value: 'open' },
                { name: 'Fermé', value: 'closed' }
            ))
        .addStringOption(option => option
            .setName('message')
            .setDescription('Remplace le message prédéfini, pour cette fois')
            .setMaxLength(4000))
        .addStringOption(option => option
            .setName('nom')
            .setDescription('Remplace le nom de salon prédéfini, pour cette fois')
            .setMaxLength(100))
        .addBooleanOption(option => option
            .setName('ping')
            .setDescription('Mentionner le rôle configuré (oui par défaut)')),

    async execute(client, interaction) {
        if (!canManageBot(interaction.member, client.config)) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        await client.services.status.updateStatus(interaction, interaction.options.getString('etat', true), {
            message: interaction.options.getString('message'),
            channelName: interaction.options.getString('nom'),
            ping: interaction.options.getBoolean('ping') ?? true
        });
    }
};
