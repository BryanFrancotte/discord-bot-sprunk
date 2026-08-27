'use strict';

const fs = require('fs');

class ConfigService {
    constructor(configPath) {
        this.configPath = configPath;
        this.config = null;
        this.watching = false;
    }

    load() {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const nextConfig = JSON.parse(raw);
        this.validate(nextConfig);
        this.config = nextConfig;
        return this.config;
    }

    get current() {
        if (!this.config) return this.load();
        return this.config;
    }

    validate(config) {
        if (!config?.bot || typeof config.bot !== 'object') {
            throw new Error('config.json doit contenir un objet "bot".');
        }

        if (!config.bot.guildId || !/^\d{17,20}$/.test(config.bot.guildId)) {
            throw new Error('Renseignez un bot.guildId Discord valide dans config.json.');
        }

        if (!Array.isArray(config.tickets) || config.tickets.length === 0) {
            throw new Error('config.json doit contenir au moins une catégorie dans "tickets".');
        }

        if (config.tickets.length > 25) {
            throw new Error('Discord limite un menu à 25 catégories de tickets.');
        }

        const ids = new Set();
        for (const ticket of config.tickets) {
            if (!ticket.id || !ticket.label || !ticket.title || !ticket.description) {
                throw new Error('Chaque ticket doit avoir id, label, title et description.');
            }
            if (ids.has(ticket.id)) {
                throw new Error(`Identifiant de ticket dupliqué : ${ticket.id}`);
            }
            ids.add(ticket.id);
        }
    }

    watch() {
        if (this.watching) return;
        this.watching = true;

        fs.watchFile(this.configPath, { interval: 1000 }, (current, previous) => {
            if (current.mtimeMs === previous.mtimeMs) return;

            try {
                this.load();
                console.log('✅ config.json rechargé.');
            } catch (error) {
                console.error('⚠️ Configuration invalide, ancienne version conservée :', error.message);
            }
        });
    }

    close() {
        if (!this.watching) return;
        fs.unwatchFile(this.configPath);
        this.watching = false;
    }
}

module.exports = ConfigService;
