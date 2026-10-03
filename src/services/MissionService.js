'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ThreadAutoArchiveDuration
} = require('discord.js');
const { PARTICIPANT_EMOJI, RESERVE_EMOJI } = require('../constants');
const { formatParisDate } = require('../utils/date');
const {
    MISSION_EDIT_CUSTOM_ID,
    applyMissionEdit,
    buildEditConfirmCustomId,
    buildMissionThreadName,
    canEditMission,
    parseMissionEdit
} = require('../utils/missions');

const MISSION_NOT_FOUND = '❌ Cette mission n’est plus suivie par le bot (terminée ou expirée).';
const MISSION_EDIT_FORBIDDEN = '❌ Seul le créateur de la mission ou le staff peut la modifier.';

class MissionService {
    constructor(client, store) {
        this.client = client;
        this.store = store;
        this.reactionQueues = new Map();
    }

    getNotificationRoleId() {
        const roleId = this.client.config.bot.missionNotificationRoleId;
        return /^\d{17,20}$/.test(roleId || '') ? roleId : null;
    }

    buildEmbed(mission) {
        const roleId = this.getNotificationRoleId();

        return new EmbedBuilder()
            .setTitle(`📋 Mission : ${mission.title} | STAFF`)
            .setDescription([
                'Une nouvelle mission a été programmée !',
                '',
                `**Mission :** ${mission.description}`,
                `**RDV :** ${mission.location}`,
                `**Date :** ${formatParisDate(new Date(mission.timestamp))}`,
                `**Places :** ${mission.maxParticipants > 0 ? mission.maxParticipants : 'Illimité'}`,
                '',
                `Réagissez avec ${PARTICIPANT_EMOJI} pour participer.`,
                `Réagissez avec ${RESERVE_EMOJI} pour être en réserve.`,
                ...(roleId ? ['', `**Notification :** <@&${roleId}>`] : [])
            ].join('\n'))
            .setColor(this.client.config.bot.color)
            .setFooter({ text: 'Réagissez pour participer ou être en réserve' })
            .setTimestamp(new Date(mission.timestamp));
    }

    buildComponents() {
        return [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(MISSION_EDIT_CUSTOM_ID)
                    .setLabel('Modifier')
                    .setEmoji('✏️')
                    .setStyle(ButtonStyle.Secondary)
            )
        ];
    }

    async create({ guild, channel, author, title, description, location, targetDate, maxParticipants }) {
        const roleId = this.getNotificationRoleId();
        const mission = {
            channelId: channel.id,
            guildId: guild.id,
            createdBy: author.id,
            title,
            description,
            location,
            timestamp: targetDate.getTime(),
            maxParticipants,
            threadId: null,
            reminded15m: false,
            reminded5m: false,
            remindedNow: false,
            cleanedUp: false,
            notificationIds: []
        };

        const message = await channel.send({
            content: roleId ? `<@&${roleId}>` : undefined,
            embeds: [this.buildEmbed(mission)],
            components: this.buildComponents(),
            allowedMentions: roleId ? { roles: [roleId] } : { parse: [] }
        });

        await message.react(PARTICIPANT_EMOJI);
        await message.react(RESERVE_EMOJI);

        const thread = await this.createDetailsThread(message, mission, author);
        mission.threadId = thread?.id ?? null;

        await this.store.update(data => {
            if (!Array.isArray(data.missions)) data.missions = [];
            data.missions.push({ id: message.id, ...mission });
        });

        return { message, thread };
    }

    // Le fil est un complément : s'il ne peut pas être créé (salon sans fils,
    // permission manquante), la mission reste publiée et fonctionnelle.
    async createDetailsThread(message, mission, author) {
        try {
            const thread = await message.startThread({
                name: buildMissionThreadName(mission.title),
                autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek
            });
            await thread.send({
                content: [
                    `👋 ${author}, ce fil est dédié à la mission **${mission.title}**.`,
                    'Ajoute ici tous les détails utiles : équipement, consignes, répartition des rôles, plan d’action…',
                    'Les participants pourront aussi y poser leurs questions.'
                ].join('\n'),
                allowedMentions: { users: [author.id] }
            });
            return thread;
        } catch (error) {
            console.error(`Fil de mission non créé pour ${message.id} :`, error.message);
            return null;
        }
    }

    async findMission(messageId) {
        const data = await this.store.read();
        return (data.missions || []).find(item => item.id === messageId) || null;
    }

    async showEditModal(interaction) {
        const mission = await this.findMission(interaction.message.id);
        if (!mission) {
            return interaction.reply({ content: MISSION_NOT_FOUND, flags: MessageFlags.Ephemeral });
        }
        if (!canEditMission(interaction.member, mission, this.client.config)) {
            return interaction.reply({ content: MISSION_EDIT_FORBIDDEN, flags: MessageFlags.Ephemeral });
        }

        const input = (customId, label, style, value, { required = true, maxLength }) => {
            const builder = new TextInputBuilder()
                .setCustomId(customId)
                .setLabel(label)
                .setStyle(style)
                .setRequired(required)
                .setMaxLength(maxLength);
            if (value) builder.setValue(value);
            return new ActionRowBuilder().addComponents(builder);
        };

        const modal = new ModalBuilder()
            .setCustomId(buildEditConfirmCustomId(mission.id))
            .setTitle('Modifier la mission')
            .addComponents(
                input('title', 'Titre', TextInputStyle.Short, mission.title, { maxLength: 100 }),
                input('description', 'Description', TextInputStyle.Paragraph, mission.description, { maxLength: 1000 }),
                input('location', 'Lieu du rendez-vous', TextInputStyle.Short, mission.location, { maxLength: 200 }),
                input('date', 'Date (JJ/MM/AAAA HH:mm, heure de Paris)', TextInputStyle.Short,
                    formatParisDate(new Date(mission.timestamp)), { maxLength: 16 }),
                input('max', 'Places (vide = illimité)', TextInputStyle.Short,
                    mission.maxParticipants > 0 ? String(mission.maxParticipants) : '', { required: false, maxLength: 3 })
            );
        await interaction.showModal(modal);
    }

    async editMission(interaction, messageId) {
        const current = await this.findMission(messageId);
        if (!current) {
            return interaction.reply({ content: MISSION_NOT_FOUND, flags: MessageFlags.Ephemeral });
        }
        if (!canEditMission(interaction.member, current, this.client.config)) {
            return interaction.reply({ content: MISSION_EDIT_FORBIDDEN, flags: MessageFlags.Ephemeral });
        }

        const parsed = parseMissionEdit({
            title: interaction.fields.getTextInputValue('title'),
            description: interaction.fields.getTextInputValue('description'),
            location: interaction.fields.getTextInputValue('location'),
            dateText: interaction.fields.getTextInputValue('date'),
            maxText: interaction.fields.getTextInputValue('max')
        }, { now: Date.now(), currentTimestamp: current.timestamp });
        if (parsed.error) {
            return interaction.reply({ content: parsed.error, flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        let mission = null;
        let changes = [];
        await this.store.update(data => {
            mission = (data.missions || []).find(item => item.id === messageId) || null;
            if (mission) changes = applyMissionEdit(mission, parsed.values);
        });

        if (!mission) return interaction.editReply(MISSION_NOT_FOUND);
        if (changes.length === 0) return interaction.editReply('ℹ️ Aucune modification.');

        const message = interaction.message?.id === messageId
            ? interaction.message
            : await (await this.client.channels.fetch(mission.channelId)).messages.fetch(messageId);
        await message.edit({ embeds: [this.buildEmbed(mission)], components: this.buildComponents() });

        const participantReaction = message.reactions.resolve(PARTICIPANT_EMOJI);
        const participantCount = participantReaction
            ? participantReaction.count - (participantReaction.me ? 1 : 0)
            : 0;
        const overflow = mission.maxParticipants > 0 && participantCount > mission.maxParticipants
            ? `\n⚠️ ${participantCount} participants sont déjà inscrits pour ${mission.maxParticipants} place(s) : personne n’a été retiré.`
            : '';

        await interaction.editReply(`✅ Mission mise à jour (${changes.join(', ')}).${overflow}`);

        // Après la réponse : Discord peut mettre en attente le renommage du fil (limite de renommage).
        await this.announceEditInThread(mission, interaction.user, changes);
    }

    async announceEditInThread(mission, editor, changes) {
        if (!mission.threadId) return;
        try {
            const thread = await this.client.channels.fetch(mission.threadId);
            if (!thread?.isThread()) return;
            await thread.send({
                content: `✏️ Mission modifiée par ${editor} : ${changes.join(', ')}.`,
                allowedMentions: { parse: [] }
            });
            if (changes.includes('titre')) {
                await thread.setName(buildMissionThreadName(mission.title));
            }
        } catch (error) {
            console.error(`Fil de mission non mis à jour pour ${mission.id} :`, error.message);
        }
    }

    async handleReaction(reaction, user) {
        if (user.bot) return;
        if (![PARTICIPANT_EMOJI, RESERVE_EMOJI].includes(reaction.emoji.name)) return;

        if (reaction.partial) {
            const fetched = await reaction.fetch().catch(() => null);
            if (!fetched) return;
        }
        if (user.partial) {
            const fetchedUser = await user.fetch().catch(() => null);
            if (!fetchedUser) return;
        }

        return this.enqueueReaction(reaction.message.id, async () => {
            const data = await this.store.read();
            const mission = data.missions.find(item => item.id === reaction.message.id);
            if (!mission) return;

            if (reaction.emoji.name === PARTICIPANT_EMOJI) {
                const reserveReaction = reaction.message.reactions.resolve(RESERVE_EMOJI);
                await reserveReaction?.users.remove(user.id).catch(() => undefined);

                if (mission.maxParticipants > 0) {
                    const users = await reaction.users.fetch();
                    const participantCount = users.filter(item => !item.bot).size;
                    if (participantCount > mission.maxParticipants) {
                        await reaction.users.remove(user.id).catch(() => undefined);
                        await user.send(
                            `❌ Désolé, la mission **${mission.title}** est déjà complète (${mission.maxParticipants} places).`
                        ).catch(() => undefined);
                        return;
                    }
                }

                await this.sendTemporaryMessage(
                    reaction.message.channel,
                    `${PARTICIPANT_EMOJI} **${user}** a accepté la mission : **${mission.title}** !`
                );
            } else {
                const participantReaction = reaction.message.reactions.resolve(PARTICIPANT_EMOJI);
                await participantReaction?.users.remove(user.id).catch(() => undefined);
                await this.sendTemporaryMessage(
                    reaction.message.channel,
                    `${RESERVE_EMOJI} **${user}** est en réserve pour la mission : **${mission.title}** !`
                );
            }
        });
    }

    enqueueReaction(messageId, task) {
        const previous = this.reactionQueues.get(messageId) || Promise.resolve();
        const current = previous.then(task, task).finally(() => {
            if (this.reactionQueues.get(messageId) === current) {
                this.reactionQueues.delete(messageId);
            }
        });
        this.reactionQueues.set(messageId, current);
        return current;
    }

    async sendTemporaryMessage(channel, content) {
        const message = await channel.send({ content });
        const duration = Number(this.client.config.missions?.transientMessageDurationMs) || 5000;
        const timer = setTimeout(() => message.delete().catch(() => undefined), duration);
        timer.unref?.();
    }
}

module.exports = MissionService;
