'use strict';

const { PARTICIPANT_EMOJI, RESERVE_EMOJI } = require('../constants');

class ReminderService {
    constructor(client, store) {
        this.client = client;
        this.store = store;
        this.timer = null;
        this.running = false;
    }

    start() {
        if (this.timer) return;
        const interval = Math.max(10000, Number(this.client.config.missions?.checkIntervalMs) || 30000);
        this.timer = setInterval(() => this.tick(), interval);
        this.timer.unref?.();
        this.tick();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    async tick() {
        if (this.running || !this.client.isReady()) return;
        this.running = true;

        try {
            await this.store.update(async data => {
                const now = Date.now();
                const retentionHours = Math.max(1, Number(this.client.config.missions?.retentionHours) || 24);
                data.missions = (data.missions || []).filter(
                    mission => now < mission.timestamp + retentionHours * 3600000
                );

                for (const mission of data.missions) {
                    await this.processMission(mission, now);
                }
            });
        } catch (error) {
            console.error('❌ Erreur du service de rappels :', error);
        } finally {
            this.running = false;
        }
    }

    async processMission(mission, now) {
        if (!Array.isArray(mission.notificationIds)) mission.notificationIds = [];
        const difference = mission.timestamp - now;

        if (difference < -10 * 60000 && !mission.remindedNow) {
            mission.reminded15m = true;
            mission.reminded5m = true;
            mission.remindedNow = true;
        } else if (!mission.remindedNow && now >= mission.timestamp) {
            const result = await this.sendReminder(mission, 'maintenant');
            if (result.handled) {
                mission.notificationIds.push(...result.notificationIds);
                mission.reminded15m = true;
                mission.reminded5m = true;
                mission.remindedNow = true;
            }
        } else if (!mission.reminded5m && now >= mission.timestamp - 5 * 60000) {
            const result = await this.sendReminder(mission, '5 minutes');
            if (result.handled) {
                mission.notificationIds.push(...result.notificationIds);
                mission.reminded15m = true;
                mission.reminded5m = true;
            }
        } else if (!mission.reminded15m && now >= mission.timestamp - 15 * 60000) {
            const result = await this.sendReminder(mission, '15 minutes');
            if (result.handled) {
                mission.notificationIds.push(...result.notificationIds);
                mission.reminded15m = true;
            }
        }

        if (mission.remindedNow && now >= mission.timestamp + 5 * 60000 && !mission.cleanedUp) {
            mission.cleanedUp = await this.deleteNotifications(mission);
        }
    }

    async sendReminder(mission, label) {
        try {
            const guild = await this.client.guilds.fetch(mission.guildId);
            const channel = await guild.channels.fetch(mission.channelId);
            if (!channel?.isTextBased() || typeof channel.send !== 'function') {
                return { handled: false, notificationIds: [] };
            }

            const message = await channel.messages.fetch(mission.id);
            const participants = await message.reactions.resolve(PARTICIPANT_EMOJI)?.users.fetch();
            const reserves = await message.reactions.resolve(RESERVE_EMOJI)?.users.fetch();
            const userIds = [...new Set([
                ...(participants?.filter(user => !user.bot).map(user => user.id) || []),
                ...(reserves?.filter(user => !user.bot).map(user => user.id) || [])
            ])];

            if (userIds.length === 0) return { handled: true, notificationIds: [] };

            const notificationIds = [];
            for (let index = 0; index < userIds.length; index += 40) {
                const chunk = userIds.slice(index, index + 40);
                const timing = label === 'maintenant'
                    ? 'La mission commence **maintenant** ! Soyez prêts.'
                    : `La mission commence dans **${label}** ! Soyez prêts.`;
                const reminder = await channel.send({
                    content: `${chunk.map(id => `<@${id}>`).join(' ')}\n\n⏰ **RAPPEL MISSION : ${mission.title}**\n${timing}`,
                    allowedMentions: { users: chunk }
                });
                notificationIds.push(reminder.id);
            }

            return { handled: true, notificationIds };
        } catch (error) {
            console.error(`Rappel non envoyé pour la mission ${mission.id} :`, error.message);
            return { handled: false, notificationIds: [] };
        }
    }

    async deleteNotifications(mission) {
        try {
            const guild = await this.client.guilds.fetch(mission.guildId);
            const channel = await guild.channels.fetch(mission.channelId);
            if (!channel?.isTextBased()) return false;

            for (const notificationId of mission.notificationIds || []) {
                const message = await channel.messages.fetch(notificationId).catch(() => null);
                if (message) await message.delete().catch(() => undefined);
            }
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = ReminderService;
