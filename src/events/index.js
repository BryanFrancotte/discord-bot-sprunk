'use strict';

const registerInteractionCreate = require('./interactionCreate');
const registerMessageCreate = require('./messageCreate');
const registerMessageReactionAdd = require('./messageReactionAdd');
const registerReady = require('./ready');

module.exports = function registerEvents(client) {
    registerReady(client);
    registerInteractionCreate(client);
    registerMessageCreate(client);
    registerMessageReactionAdd(client);
};
