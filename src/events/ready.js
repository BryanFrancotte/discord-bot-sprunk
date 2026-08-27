'use strict';

const { Events } = require('discord.js');

module.exports = function registerReady(client) {
    client.once(Events.ClientReady, async readyClient => {
        console.log(`✅ SPRUNK Bot connecté en tant que ${readyClient.user.tag}.`);

        try {
            await client.services.commandRegistry.register();
        } catch (error) {
            console.error('❌ Enregistrement des commandes impossible :', error);
        }

        client.services.reminders.start();
    });
};
