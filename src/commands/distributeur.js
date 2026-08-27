'use strict';

const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { canManageBot, hasRole } = require('../utils/permissions');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('distributeur')
        .setDescription('Publier les informations d’installation d’un distributeur'),

    async execute(client, interaction) {
        const allowed = canManageBot(interaction.member, client.config) ||
            hasRole(interaction.member, client.config.bot.distributorRoleId);
        if (!allowed) {
            return interaction.reply({ content: '❌ Non autorisé.', flags: MessageFlags.Ephemeral });
        }

        if (!interaction.channel?.isTextBased() || typeof interaction.channel.send !== 'function') {
            return interaction.reply({
                content: '❌ Cette commande ne peut pas être utilisée ici.',
                flags: MessageFlags.Ephemeral
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🥤 SPRUNK | INSTALLATION DE DISTRIBUTEUR')
            .setDescription([
                'Bonjour et bienvenue au Sprunk !',
                '',
                'Pourriez-vous nous transmettre la position GPS précise du distributeur, accompagnée de photos indiquant son emplacement exact ?',
                '',
                'L’emplacement ne peut pas gêner la circulation des véhicules, bloquer complètement un trottoir, ni se trouver sur la propriété d’une entreprise qui ne vous appartient pas.',
                '',
                'L’installation représente un coût de **15 000 $**. En contrepartie, vous percevrez **40 %** des ventes générées.',
                '',
                'Les recharges seront entièrement prises en charge par nos soins. Vous devez être engagé au Sprunk pendant le temps nécessaire à l’installation et disposer d’un RSA pour le poser et le conserver.',
                '',
                'Un contrat officiel sera rédigé et signé lors de l’installation.'
            ].join('\n'))
            .setColor(client.config.bot.color)
            .setFooter({ text: client.config.bot.footerText })
            .setTimestamp();

        await interaction.channel.send({ embeds: [embed] });
        await interaction.reply({
            content: '✅ Le message a été publié anonymement.',
            flags: MessageFlags.Ephemeral
        });
    }
};
