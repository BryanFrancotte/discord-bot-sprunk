'use strict';

const { isDiscordId } = require('../utils/config');

class DiscordLogService {
    constructor(client) {
        this.client = client;
    }

    async send(guild, embed, attachment = null) {
        const channelId = this.client.config.bot.logsChannelId;
        if (!isDiscordId(channelId)) return false;

        try {
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel?.isTextBased() || typeof channel.send !== 'function') return false;

            const payload = { embeds: [embed] };
            if (attachment) payload.files = [attachment];
            await channel.send(payload);
            return true;
        } catch (error) {
            if (![50001, 50013, 10003].includes(error.code)) {
                console.error('❌ Envoi du log Discord impossible :', error.message);
            }
            return false;
        }
    }
}

module.exports = DiscordLogService;
