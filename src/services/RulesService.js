'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');
const { hasRole } = require('../utils/permissions');
const { isDiscordId } = require('../utils/config');

const KEYCAPS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

const DEFAULT_RULES = {
    title: '📜 RÈGLEMENT',
    warning: '⚠️ **PRÉNOM ET NOM OBLIGATOIRE** ⚠️',
    items: [
        'Respectez les autres membres du serveur. Pas de harcèlement, de discours de haine, de racisme, de sexisme ou de toute autre forme de discrimination.',
        'Pas de contenu offensant, obscène, choquant ou inapproprié.',
        'Aucune publicité ou promotion de contenu tiers sans autorisation préalable.',
        'Pas de spamming, de troll, ou de tout autre comportement perturbateur.',
        'Respectez les règles spécifiques de chaque salon/catégorie du serveur.',
        'Ne partagez pas d’informations personnelles ou de coordonnées.',
        'Le staff se réserve le droit de supprimer tout contenu jugé inapproprié ou de bannir des membres en cas de violation des règles.'
    ],
    note: 'Les règles peuvent être modifiées à tout moment sans préavis.',
    buttonLabel: 'Lu et Approuvé'
};

class RulesService {
    constructor(client) {
        this.client = client;
    }

    buildRulesEmbed() {
        const rules = this.client.config.rules ?? {};
        const items = Array.isArray(rules.items) && rules.items.length > 0 ? rules.items : DEFAULT_RULES.items;
        const warning = rules.warning ?? DEFAULT_RULES.warning;
        const note = rules.note ?? DEFAULT_RULES.note;

        const description = [
            ...(warning ? [warning, ''] : []),
            ...items.flatMap((item, index) => [`${KEYCAPS[index] ?? `${index + 1}.`} ${item}`, '']),
            ...(note ? [`*${note}*`] : [])
        ].join('\n');

        if (description.length > 4096) {
            throw new Error('Le règlement dépasse 4096 caractères : raccourcissez config.rules.');
        }

        return new EmbedBuilder()
            .setTitle(rules.title ?? DEFAULT_RULES.title)
            .setDescription(description)
            .setColor(this.client.config.bot.color)
            .setFooter({ text: this.client.config.bot.footerText });
    }

    buildAcceptRow() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('rules:accept')
                .setLabel(this.client.config.rules?.buttonLabel || DEFAULT_RULES.buttonLabel)
                .setEmoji('✅')
                .setStyle(ButtonStyle.Success)
        );
    }

    async sendRules(channel) {
        if (!channel?.isTextBased() || typeof channel.send !== 'function') {
            throw new Error('Ce salon ne permet pas l’envoi du règlement.');
        }

        return channel.send({
            embeds: [this.buildRulesEmbed()],
            components: [this.buildAcceptRow()]
        });
    }

    async acceptRules(interaction) {
        const roleId = this.client.config.rules?.memberRoleId;
        if (!isDiscordId(roleId)) {
            return interaction.reply({
                content: '❌ Le rôle membre n’est pas configuré (rules.memberRoleId dans config.json).',
                flags: MessageFlags.Ephemeral
            });
        }

        if (hasRole(interaction.member, roleId)) {
            return interaction.reply({
                content: '✅ Vous avez déjà accepté le règlement.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await interaction.member.roles.add(roleId, 'Règlement accepté');
        } catch (error) {
            // 50013 : le rôle du bot est placé sous le rôle membre, ou il lui manque « Gérer les rôles ».
            if (error.code !== 50013) throw error;
            return interaction.reply({
                content: '❌ Le bot ne peut pas attribuer ce rôle. Son rôle doit être placé au-dessus du rôle membre et disposer de « Gérer les rôles ».',
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.reply({
            content: '✅ Merci d’avoir accepté le règlement, votre accès est ouvert !',
            flags: MessageFlags.Ephemeral
        });
    }
}

module.exports = RulesService;
