'use strict';

const { EmbedBuilder } = require('discord.js');
const { PARTICIPANT_EMOJI, RESERVE_EMOJI } = require('../constants');

class MissionService {
    constructor(client, store) {
        this.client = client;
        this.store = store;
        this.reactionQueues = new Map();
    }

    async create({ guild, channel, author, title, description, location, targetDate, dateText, maxParticipants }) {
        const config = this.client.config;
        const roleId = config.bot.missionNotificationRoleId;
        const roleMention = /^\d{17,20}$/.test(roleId || '') ? `<@&${roleId}>` : null;

        const embed = new EmbedBuilder()
            .setTitle(`📋 Mission : ${title} | STAFF`)
            .setDescription([
                'Une nouvelle mission a été programmée !',
                '',
                `**Mission :** ${description}`,
                `**RDV :** ${location}`,
                `**Date :** ${dateText}`,
                `**Places :** ${maxParticipants > 0 ? maxParticipants : 'Illimité'}`,
                '',
                `Réagissez avec ${PARTICIPANT_EMOJI} pour participer.`,
                `Réagissez avec ${RESERVE_EMOJI} pour être en réserve.`,
                ...(roleMention ? ['', `**Notification :** ${roleMention}`] : [])
            ].join('\n'))
            .setColor(config.bot.color)
            .setFooter({ text: 'Réagissez pour participer ou être en réserve' })
            .setTimestamp(targetDate);

        const message = await channel.send({
            content: roleMention || undefined,
            embeds: [embed],
            allowedMentions: roleMention ? { roles: [roleId] } : { parse: [] }
        });

        await message.react(PARTICIPANT_EMOJI);
        await message.react(RESERVE_EMOJI);

        await this.store.update(data => {
            if (!Array.isArray(data.missions)) data.missions = [];
            data.missions.push({
                id: message.id,
                channelId: channel.id,
                guildId: guild.id,
                createdBy: author.id,
                title,
                description,
                location,
                timestamp: targetDate.getTime(),
                maxParticipants,
                reminded15m: false,
                reminded5m: false,
                remindedNow: false,
                cleanedUp: false,
                notificationIds: []
            });
        });

        return message;
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
