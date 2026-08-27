'use strict';

const fs = require('fs/promises');
const path = require('path');

class JsonStore {
    constructor(filePath, defaultValue) {
        this.filePath = filePath;
        this.defaultValue = defaultValue;
        this.queue = Promise.resolve();
    }

    async initialize() {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        try {
            await fs.access(this.filePath);
        } catch {
            await this.writeValue(structuredClone(this.defaultValue));
        }

        // Échoue clairement au démarrage plutôt que d’écraser un JSON corrompu.
        await this.readValue();
    }

    async read() {
        await this.queue;
        return this.readValue();
    }

    async update(mutator) {
        const operation = this.queue.then(async () => {
            const current = await this.readValue();
            const result = await mutator(current);
            const next = result === undefined ? current : result;
            await this.writeValue(next);
            return structuredClone(next);
        });

        this.queue = operation.catch(() => undefined);
        return operation;
    }

    async readValue() {
        const raw = await fs.readFile(this.filePath, 'utf8');
        return JSON.parse(raw);
    }

    async writeValue(value) {
        await fs.writeFile(this.filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    }
}

module.exports = JsonStore;
