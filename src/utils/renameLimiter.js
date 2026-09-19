'use strict';

// Discord n’autorise que deux renommages d’un même salon par tranche de 10 minutes ;
// au-delà, discord.js met la requête en attente au lieu d’échouer.
const RENAME_LIMIT = 2;
const RENAME_WINDOW_MS = 10 * 60 * 1000;

// Ne compte que les renommages faits par le bot depuis son démarrage : sert à refuser
// proprement avant que discord.js ne fasse patienter la requête.
class RenameLimiter {
    constructor() {
        this.history = new Map();
    }

    getRetryDelay(channelId, now = Date.now()) {
        const recent = (this.history.get(channelId) ?? [])
            .filter(timestamp => now - timestamp < RENAME_WINDOW_MS);
        this.history.set(channelId, recent);

        if (recent.length < RENAME_LIMIT) return 0;
        return RENAME_WINDOW_MS - (now - recent[0]);
    }

    record(channelId, now = Date.now()) {
        const history = this.history.get(channelId) ?? [];
        history.push(now);
        this.history.set(channelId, history);
    }
}

function formatRenameLimitMessage(retryDelay) {
    return `⏳ Discord limite le renommage d’un salon à ${RENAME_LIMIT} fois par tranche de 10 minutes. ` +
        `Réessayez dans ${Math.ceil(retryDelay / 60000)} min — rien n’a été modifié.`;
}

module.exports = { RENAME_LIMIT, RENAME_WINDOW_MS, RenameLimiter, formatRenameLimitMessage };
