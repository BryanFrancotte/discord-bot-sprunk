'use strict';

const { Events } = require('discord.js');
const { replyWithError } = require('../utils/async');
const { MISSION_EDIT_CUSTOM_ID, parseEditConfirmCustomId } = require('../utils/missions');
const { parsePictureCustomId } = require('../utils/pictureValidation');

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
                } else if (interaction.customId === 'ticket:assign') {
                    await client.services.assignment.showAssignMenu(interaction);
                } else if (interaction.customId === 'ticket:status') {
                    await client.services.assignment.showStatusMenu(interaction);
                } else if (interaction.customId === 'rules:accept') {
                    await client.services.rules.acceptRules(interaction);
                } else if (interaction.customId === MISSION_EDIT_CUSTOM_ID) {
                    await client.services.missions.showEditModal(interaction);
                } else {
                    const picture = parsePictureCustomId(interaction.customId);
                    if (picture?.action === 'approve') {
                        await client.services.pictures.approve(interaction, picture);
                    } else if (picture?.action === 'reject') {
                        await client.services.pictures.showRejectModal(interaction, picture);
                    }
                }
                return;
            }

            if (interaction.isStringSelectMenu()) {
                if (interaction.customId === 'ticket:category') {
                    await client.services.tickets.createTicket(interaction, interaction.values[0]);
                } else if (interaction.customId === 'ticket:reassign-confirm') {
                    await client.services.tickets.reassignTicket(interaction, interaction.values[0]);
                } else if (interaction.customId === 'ticket:assign-confirm') {
                    await client.services.assignment.assignTicket(interaction, interaction.values[0]);
                } else if (interaction.customId === 'ticket:status-confirm') {
                    await client.services.assignment.setStatus(interaction, interaction.values[0]);
                } else if (interaction.customId.startsWith('ticket:acquire-confirm:')) {
                    const acquire = client.services.tickets.parseAcquireCustomId(interaction.customId);
                    if (acquire) {
                        await client.services.tickets.acquireChannel(interaction, interaction.values[0], acquire.ownerId, {
                            silent: acquire.silent
                        });
                    }
                }
                return;
            }

            if (interaction.isModalSubmit()) {
                if (interaction.customId === 'ticket:rename-confirm') {
                    await client.services.tickets.renameTicket(interaction);
                } else if (interaction.customId === 'ticket:architecture-confirm') {
                    await client.services.tickets.createArchitectureTicket(interaction);
                } else {
                    const picture = parsePictureCustomId(interaction.customId);
                    const missionId = parseEditConfirmCustomId(interaction.customId);
                    if (picture?.action === 'reject-confirm') {
                        await client.services.pictures.reject(interaction, picture);
                    } else if (missionId) {
                        await client.services.missions.editMission(interaction, missionId);
                    }
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
