'use strict';

const { delay } = require('../utils/async');

const DEFAULT_MESSAGES = [
    'Hey ! Tu fais quoi ? 👀',
    'On m’a dit que tu aimais les surprises… 🎁',
    'Regarde ça ! 😂',
    'Tu es là ? 🤔',
    'Oups, encore un message ! 😅',
    'Tu dors ? 💤',
    'C’est cadeau ! ✨',
    'Trollé ! 😈'
];

class TrollService {
    constructor(client) {
        this.client = client;
        this.cooldowns = new Map();
    }

    getRemainingCooldown(targetId) {
        const until = this.cooldowns.get(targetId) || 0;
        return Math.max(0, until - Date.now());
    }

    async send(target) {
        const config = this.client.config.troll || {};
        if (config.enabled !== true) {
            throw new Error('La commande troll est désactivée dans config.json.');
        }

        const remaining = this.getRemainingCooldown(target.id);
        if (remaining > 0) {
            throw new Error(`Cette cible est en cooldown pour encore ${Math.ceil(remaining / 60000)} minute(s).`);
        }

        const count = Math.min(15, Math.max(1, Number(config.messageCount) || 5));
        const delayMs = Math.max(800, Number(config.delayMs) || 1000);
        const cooldownMs = Math.max(60000, Number(config.cooldownMs) || 600000);
        const gifs = Array.isArray(config.gifs) ? config.gifs.filter(Boolean) : [];
        this.cooldowns.set(target.id, Date.now() + cooldownMs);

        let sent = 0;
        for (let index = 0; index < count; index += 1) {
            const text = DEFAULT_MESSAGES[Math.floor(Math.random() * DEFAULT_MESSAGES.length)];
            const gif = gifs.length > 0 ? gifs[Math.floor(Math.random() * gifs.length)] : null;
            await target.send(gif ? `${text}\n${gif}` : text);
            sent += 1;
            if (index < count - 1) await delay(delayMs);
        }

        return sent;
    }
}

module.exports = TrollService;
