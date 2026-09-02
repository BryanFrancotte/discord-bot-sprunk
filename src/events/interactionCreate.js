'use strict';

const { Events } = require('discord.js');
const { replyWithError } = require('../utils/async');

module.exports = function registerInteractionCreate(client) {
    client.on(Events.InteractionCreate, async interaction => {
        try {
            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                if (!command) return;
                await command.execute(client, interaction);
                return;
            }

            if (interaction.isButton()) {
                if (interaction.customId === 'ticket:open') {
                    await client.services.tickets.showCategoryMenu(interaction);
                } else if (interaction.customId === 'ticket:close') {
                    await client.services.tickets.closeTicket(interaction);
                } else if (interaction.customId === 'ticket:reassign') {
                    await client.services.tickets.showReassignMenu(interaction);
                } else if (interaction.customId === 'ticket:rename') {
                    await client.services.tickets.showRenameModal(interaction);
                } else if (interaction.customId === 'ticket:add-user') {
                    await client.services.tickets.showAddUserMenu(interaction);
                } else if (interaction.customId === 'ticket:remove-user') {
                    await client.services.tickets.showRemoveUserMenu(interaction);
                }
                return;
            }

            if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'ticket:category') {
                    await client.services.tickets.createTicket(interaction, interaction.values[0]);
                } else if (interaction.customId === 'ticket:reassign-confirm') {
                    await client.services.tickets.reassignTicket(interaction, interaction.values[0]);
                }
                return;
            }

            if (interaction.isModalSubmit()) {
                if (interaction.customId === 'ticket:rename-confirm') {
                    await client.services.tickets.renameTicket(interaction);
                } else if (interaction.customId === 'ticket:architecture-confirm') {
                    await client.services.tickets.createArchitectureTicket(interaction);
                }
                return;
            }

            if (interaction.isUserSelectMenu()) {
                if (interaction.customId === 'ticket:add-user-confirm') {
                    await client.services.tickets.addUsersToTicket(interaction, interaction.values);
                } else if (interaction.customId === 'ticket:remove-user-confirm') {
                    await client.services.tickets.removeUsersFromTicket(interaction, interaction.values);
                }
            }
        } catch (error) {
            console.error('❌ Erreur interactionCreate :', error);
            await replyWithError(interaction);
        }
    });
};
