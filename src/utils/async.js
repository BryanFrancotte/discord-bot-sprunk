'use strict';

const { MessageFlags } = require('discord.js');

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function replyWithError(interaction, message = '❌ Une erreur inattendue est survenue.') {
    const payload = { content: message, flags: MessageFlags.Ephemeral };

    try {
        if (interaction.deferred && !interaction.replied && interaction.ephemeral !== null) {
            await interaction.editReply({ content: message });
        } else if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload);
        } else if (interaction.isRepliable()) {
            await interaction.reply(payload);
        }
    } catch (error) {
        console.error('Impossible de répondre à l’interaction :', error.message);
    }
}

module.exports = { delay, replyWithError };
