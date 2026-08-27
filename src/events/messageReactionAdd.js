'use strict';

const { Events } = require('discord.js');

module.exports = function registerMessageReactionAdd(client) {
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
        try {
            await client.services.missions.handleReaction(reaction, user);
        } catch (error) {
            console.error('❌ Erreur de réaction de mission :', error);
        }
    });
};
