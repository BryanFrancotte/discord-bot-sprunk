'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { canManageBot } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('troll')
        .setDescription('Envoyer une série limitée de messages privés à un utilisateur')
        .addUserOption(option => option
            .setName('cible')
            .setDescription('Utilisateur ciblé')
            .setRequired(true)),

    async execute(client, interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!canManageBot(interaction.member, client.config)) {
            return interaction.editReply('❌ Non autorisé.');
        }

        const target = interaction.options.getUser('cible', true);
        if (target.bot) return interaction.editReply('❌ Impossible de cibler un bot.');
        if (target.id === interaction.user.id) return interaction.editReply('❌ Vous ne pouvez pas vous cibler vous-même.');

        try {
            const sent = await client.services.troll.send(target);
            await interaction.editReply(`✅ ${sent} message(s) envoyé(s) à **${target.tag}**.`);
        } catch (error) {
            await interaction.editReply(`❌ Opération interrompue : ${error.message}`);
        }
    }
};
