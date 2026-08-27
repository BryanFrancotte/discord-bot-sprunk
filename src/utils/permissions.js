'use strict';

const { PermissionFlagsBits } = require('discord.js');

function hasRole(member, roleId) {
    return Boolean(roleId && member?.roles?.cache?.has(roleId));
}

function isAdministrator(member) {
    return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function canManageBot(member, config) {
    return isAdministrator(member) || hasRole(member, config.bot.reassignRoleId);
}

module.exports = { canManageBot, hasRole, isAdministrator };
