'use strict';

const { REST, Routes } = require('discord.js');

class CommandRegistry {
    constructor(client, token, commands) {
        this.client = client;
        this.commands = commands;
        this.rest = new REST({ version: '10' }).setToken(token);
    }

    async register() {
        const { bot } = this.client.config;
        const body = [...this.commands.values()].map(command => command.data.toJSON());

        if (bot.clearGlobalCommandsOnStartup === true) {
            await this.rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: [] }
            );
            console.log('✅ Commandes globales nettoyées.');
        }

        await this.rest.put(
            Routes.applicationGuildCommands(this.client.user.id, bot.guildId),
            { body }
        );

        console.log(`✅ ${body.length} commandes enregistrées sur le serveur ${bot.guildId}.`);
    }
}

module.exports = CommandRegistry;
