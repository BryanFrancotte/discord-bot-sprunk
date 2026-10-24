'use strict';

const { Events } = require('discord.js');
const { isAdministrator } = require('../utils/permissions');

module.exports = function registerMessageCreate(client) {
    client.on(Events.MessageCreate, async message => {
        if (message.author.bot || !message.inGuild()) return;

        if (message.attachments.size > 0) {
            try {
                await client.services.pictures.submit(message);
            } catch (error) {
                console.error('❌ Erreur de la validation des photos :', error);
            }
        }

        if (message.content.trim().toLowerCase() !== '!setup') return;
        if (!isAdministrator(message.member)) return;

        try {
            await client.services.tickets.sendPanel(message.channel);
            await message.delete().catch(() => undefined);
        } catch (error) {
            console.error('❌ Erreur de la commande !setup :', error);
        }
    });
};
