'use strict';

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('assigner')
        .setDescription('Assigner ce ticket à un architecte (vous-même par défaut)')
        .addUserOption(option => option
            .setName('architecte')
            .setDescription('Architecte à assigner (réservé au staff si ce n’est pas vous)')),

    async execute(client, interaction) {
        const architect = interaction.options.getUser('architecte') ?? interaction.user;
        await client.services.assignment.assignTicket(interaction, architect.id);
    }
};
