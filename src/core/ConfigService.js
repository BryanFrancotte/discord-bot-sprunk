'use strict';

const fs = require('fs');
const { STATUS_KEYS } = require('../utils/ticketAssignment');

class ConfigService {
    constructor(configPath) {
        this.configPath = configPath;
        this.config = null;
        this.loadedRaw = null;
        this.watching = false;
    }

    load() {
        return this.apply(fs.readFileSync(this.configPath, 'utf8'));
    }

    get current() {
        if (!this.config) return this.load();
        return this.config;
    }

    apply(raw) {
        const nextConfig = JSON.parse(raw);
        this.validate(nextConfig);
        this.config = nextConfig;
        this.loadedRaw = raw;
        return this.config;
    }

    // Écrit une nouvelle configuration de façon atomique : validation d’abord,
    // puis fichier temporaire + rename, pour qu’un lecteur ne voie jamais un JSON tronqué.
    save(nextConfig) {
        this.validate(nextConfig);

        const raw = `${JSON.stringify(nextConfig, null, 2)}\n`;
        const temporaryPath = `${this.configPath}.tmp`;

        try {
            fs.writeFileSync(temporaryPath, raw, 'utf8');
            fs.renameSync(temporaryPath, this.configPath);
        } catch (error) {
            try {
                fs.unlinkSync(temporaryPath);
            } catch {
                // Le fichier temporaire n’existe pas : rien à nettoyer.
            }
            throw error;
        }

        return this.apply(raw);
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
            if (ticket.assignment !== undefined) this.validateAssignment(ticket);
        }
    }

    validateAssignment(ticket) {
        const { assignment } = ticket;
        const prefix = `tickets[${ticket.id}].assignment`;
        if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
            throw new Error(`${prefix} doit être un objet.`);
        }

        const architects = assignment.architects ?? {};
        if (typeof architects !== 'object' || Array.isArray(architects)) {
            throw new Error(`${prefix}.architects doit associer un ID Discord à un emoji.`);
        }
        for (const [userId, emoji] of Object.entries(architects)) {
            if (!/^\d{17,20}$/.test(userId)) {
                throw new Error(`${prefix}.architects : « ${userId} » n’est pas un ID Discord valide.`);
            }
            if (typeof emoji !== 'string' || !emoji.trim()) {
                throw new Error(`${prefix}.architects : emoji manquant pour ${userId}.`);
            }
        }

        const statuses = assignment.statuses ?? {};
        for (const [key, status] of Object.entries(statuses)) {
            if (!STATUS_KEYS.includes(key)) {
                throw new Error(`${prefix}.statuses : statut inconnu « ${key} » (attendus : ${STATUS_KEYS.join(', ')}).`);
            }
            if (status?.emoji !== undefined && (typeof status.emoji !== 'string' || !status.emoji.trim())) {
                throw new Error(`${prefix}.statuses.${key}.emoji doit être un emoji non vide.`);
            }
        }
    }

    watch() {
        if (this.watching) return;
        this.watching = true;

        fs.watchFile(this.configPath, { interval: 1000 }, (current, previous) => {
            if (current.mtimeMs === previous.mtimeMs) return;

            try {
                const raw = fs.readFileSync(this.configPath, 'utf8');
                // Ignore les écritures venant du bot lui-même (save) et les touch sans changement.
                if (raw === this.loadedRaw) return;

                this.apply(raw);
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
