'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ConfigService = require('../src/core/ConfigService');

function buildConfig(overrides = {}) {
    return {
        bot: {
            guildId: '123456789012345678',
            color: '#00ff11',
            footerText: 'SPRUNK'
        },
        tickets: [{
            id: 'support',
            label: 'Support',
            title: 'Support',
            description: 'Bonjour {user}'
        }],
        ...overrides
    };
}

async function createService(context, config = buildConfig()) {
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'sprunk-config-test-'));
    const configPath = path.join(directory, 'config.json');
    await fsp.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    context.after(async () => {
        await fsp.rm(directory, { recursive: true, force: true });
    });

    return { service: new ConfigService(configPath), configPath, directory };
}

test('save écrit la configuration sur disque et met à jour la copie en mémoire', async context => {
    const { service, configPath, directory } = await createService(context);
    service.load();

    const nextConfig = buildConfig();
    nextConfig.bot.footerText = 'SPRUNK v2';
    nextConfig.tickets.push({
        id: 'recrutement',
        label: 'Recrutement',
        title: 'Recrutement',
        description: 'Bonjour {user}'
    });

    const saved = service.save(nextConfig);

    assert.equal(saved.bot.footerText, 'SPRUNK v2');
    assert.equal(service.current.tickets.length, 2);

    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(onDisk.bot.footerText, 'SPRUNK v2');
    assert.equal(onDisk.tickets.length, 2);

    // Le fichier temporaire de l’écriture atomique ne doit pas survivre.
    assert.deepEqual(fs.readdirSync(directory), ['config.json']);
});

test('save refuse une configuration invalide sans toucher au fichier', async context => {
    const { service, configPath, directory } = await createService(context);
    service.load();

    const before = fs.readFileSync(configPath, 'utf8');
    const invalidConfig = buildConfig({ tickets: [] });

    assert.throws(() => service.save(invalidConfig), /au moins une catégorie/);

    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
    assert.equal(service.current.tickets.length, 1);
    assert.deepEqual(fs.readdirSync(directory), ['config.json']);
});

test('save rejette un doublon d’identifiant de ticket', async context => {
    const { service } = await createService(context);
    service.load();

    const duplicated = buildConfig();
    duplicated.tickets.push({ ...duplicated.tickets[0] });

    assert.throws(() => service.save(duplicated), /dupliqué/);
});

test('une nouvelle instance relit ce qui a été sauvegardé', async context => {
    const { service, configPath } = await createService(context);
    service.load();

    const nextConfig = buildConfig();
    nextConfig.bot.logsChannelId = '123456789012345679';
    service.save(nextConfig);

    const reloaded = new ConfigService(configPath).load();
    assert.equal(reloaded.bot.logsChannelId, '123456789012345679');
});

test('load mémorise le contenu brut pour distinguer une modification externe', async context => {
    const { service, configPath } = await createService(context);
    service.load();

    assert.equal(service.loadedRaw, fs.readFileSync(configPath, 'utf8'));

    service.save(buildConfig({ missions: { checkIntervalMs: 30000 } }));
    assert.equal(service.loadedRaw, fs.readFileSync(configPath, 'utf8'));
});

test('validate accepte un bloc assignment valide et rejette un mapping incorrect', async context => {
    const { service } = await createService(context);
    const withAssignment = assignment => buildConfig({
        tickets: [{
            id: 'architecture',
            label: 'Architecture',
            title: 'Architecture',
            description: 'Bonjour {user}',
            assignment
        }]
    });

    assert.doesNotThrow(() => service.validate(withAssignment({ architects: { '123456789012345678': '🦊' } })));
    assert.doesNotThrow(() => service.validate(withAssignment({ architects: {}, statuses: { paid: { emoji: '💰' } } })));
    assert.throws(() => service.validate(withAssignment({ architects: { bob: '🦊' } })), /ID Discord valide/);
    assert.throws(() => service.validate(withAssignment({ architects: { '123456789012345678': '' } })), /emoji manquant/);
    assert.throws(() => service.validate(withAssignment({ statuses: { annule: { emoji: '❌' } } })), /statut inconnu/);
    assert.throws(() => service.validate(withAssignment([])), /doit être un objet/);
});
