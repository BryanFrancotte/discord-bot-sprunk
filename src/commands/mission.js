'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { parseParisDate } = require('../utils/date');
const { canManageBot } = require('../utils/permissions');
const { isDiscordId } = require('../utils/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mission')
        .setDescription('Créer une mission avec rappels automatiques')
        .addStringOption(option => option
            .setName('titre')
            .setDescription('Titre de la mission')
            .setMaxLength(100)
            .setRequired(true))
        .addStringOption(option => option
            .setName('description')
            .setDescription('Description de ce qu’il faut faire')
            .setMaxLength(1000)
            .setRequired(true))
        .addStringOption(option => option
            .setName('lieu')
            .setDescription('Lieu du rendez-vous')
            .setMaxLength(200)
            .setRequired(true))
        .addStringOption(option => option
            .setName('date')
            .setDescription('JJ/MM/AAAA HH:mm — ex. 15/04/2027 21:00')
            .setRequired(true))
        .addIntegerOption(option => option
            .setName('max')
            .setDescription('Nombre maximal de participants')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(false)),

    async execute(client, interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!canManageBot(interaction.member, client.config)) {
            return interaction.editReply('❌ Non autorisé.');
        }

        const title = interaction.options.getString('titre', true);
        const description = interaction.options.getString('description', true);
        const location = interaction.options.getString('lieu', true);
        const dateText = interaction.options.getString('date', true);
        const maxParticipants = interaction.options.getInteger('max') || 0;
        const targetDate = parseParisDate(dateText);

        if (!targetDate || targetDate.getTime() <= Date.now()) {
            return interaction.editReply(
                '❌ Date invalide ou passée. Utilisez JJ/MM/AAAA HH:mm avec une heure valide à Paris.'
            );
        }

        const configuredChannelId = client.config.bot.missionChannelId;
        const channelId = isDiscordId(configuredChannelId) ? configuredChannelId : interaction.channelId;
        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased() || typeof channel.send !== 'function') {
            return interaction.editReply('❌ Salon de mission introuvable ou invalide.');
        }

        const message = await client.services.missions.create({
            guild: interaction.guild,
            channel,
            author: interaction.user,
            title,
            description,
            location,
            targetDate,
            dateText,
            maxParticipants
        });

        await interaction.editReply(
            `✅ Mission créée dans ${channel} — [ouvrir le message](${message.url}) — ${maxParticipants || 'illimité'} place(s).`
        );
    }
};
