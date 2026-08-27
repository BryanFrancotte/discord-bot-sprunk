'use strict';

const path = require('path');
const {
    Client,
    Collection,
    GatewayIntentBits,
    Partials
} = require('discord.js');
const commands = require('../commands');
const registerEvents = require('../events');
const JsonStore = require('../services/JsonStore');
const CommandRegistry = require('../services/CommandRegistry');
const DiscordLogService = require('../services/DiscordLogService');
const MissionService = require('../services/MissionService');
const ReminderService = require('../services/ReminderService');
const TicketLogService = require('../services/TicketLogService');
const TicketService = require('../services/TicketService');
const TrollService = require('../services/TrollService');

class SprunkClient extends Client {
    constructor({ configService, token, dataDirectory }) {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessageReactions
            ],
            partials: [
                Partials.Message,
                Partials.Channel,
                Partials.Reaction,
                Partials.User
            ],
            allowedMentions: {
                parse: ['roles', 'users'],
                repliedUser: false
            }
        });

        this.configService = configService;
        this.token = token;
        this.dataDirectory = dataDirectory;
        this.commands = new Collection(commands.map(command => [command.data.name, command]));
        this.services = {};
    }

    get config() {
        return this.configService.current;
    }

    async initialize() {
        const missionStore = new JsonStore(
            path.join(this.dataDirectory, 'missions.json'),
            { missions: [] }
        );
        const ticketLogStore = new JsonStore(
            path.join(this.dataDirectory, 'ticket-logs.json'),
            { tickets: [] }
        );
        await Promise.all([missionStore.initialize(), ticketLogStore.initialize()]);

        const discordLogs = new DiscordLogService(this);
        const ticketLogs = new TicketLogService(ticketLogStore);

        this.services.commandRegistry = new CommandRegistry(this, this.token, this.commands);
        this.services.discordLogs = discordLogs;
        this.services.ticketLogs = ticketLogs;
        this.services.tickets = new TicketService(this, ticketLogs, discordLogs);
        this.services.missions = new MissionService(this, missionStore);
        this.services.reminders = new ReminderService(this, missionStore);
        this.services.troll = new TrollService(this);

        registerEvents(this);
        this.configService.watch();
    }

    async start() {
        await this.initialize();
        await this.login(this.token);
    }

    async shutdown() {
        this.services.reminders?.stop();
        this.configService.close();
        this.destroy();
    }
}

module.exports = SprunkClient;
