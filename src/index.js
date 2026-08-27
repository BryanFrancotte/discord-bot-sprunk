'use strict';

require('dotenv').config();

const path = require('path');
const { PARIS_TIME_ZONE } = require('./constants');
const ConfigService = require('./core/ConfigService');
const InstanceLock = require('./core/InstanceLock');
const SprunkClient = require('./core/SprunkClient');

process.env.TZ = PARIS_TIME_ZONE;

const projectDirectory = path.resolve(__dirname, '..');
const lock = new InstanceLock(path.join(projectDirectory, '.bot.lock'));
let client = null;
let shuttingDown = false;

async function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
        await client?.shutdown();
    } catch (error) {
        console.error('Erreur pendant l’arrêt du bot :', error);
    } finally {
        lock.release();
        process.exit(exitCode);
    }
}

async function main() {
    const token = process.env.BOT_TOKEN;
    if (!token) throw new Error('BOT_TOKEN est absent du fichier .env.');

    lock.acquire();
    const configService = new ConfigService(path.join(projectDirectory, 'config.json'));
    configService.load();

    client = new SprunkClient({
        configService,
        token,
        dataDirectory: path.join(projectDirectory, 'data')
    });
    await client.start();
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
process.once('exit', () => lock.release());
process.on('unhandledRejection', error => {
    console.error('Promesse rejetée non gérée :', error);
});
process.on('uncaughtException', error => {
    console.error('Exception non gérée :', error);
    shutdown(1);
});

main().catch(error => {
    console.error(`❌ Démarrage impossible : ${error.message}`);
    lock.release();
    process.exitCode = 1;
});
