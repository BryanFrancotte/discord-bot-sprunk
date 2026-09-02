'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const commands = require('../src/commands');
const TicketService = require('../src/services/TicketService');

test('les commandes slash sont sérialisables et ont des noms uniques', () => {
    const serialized = commands.map(command => command.data.toJSON());
    const names = serialized.map(command => command.name);

    assert.deepEqual(names.sort(), ['distributeur', 'mission', 'template', 'troll']);
    assert.equal(new Set(names).size, names.length);
});

test('les métadonnées d’un ticket peuvent être relues depuis son topic', () => {
    const service = new TicketService({}, {}, {});
    const topic = service.buildTopic('123456789012345678', 'support-rh');

    assert.deepEqual(service.parseTopic(topic), {
        ownerId: '123456789012345678',
        categoryId: 'support-rh'
    });
    assert.equal(service.parseTopic('topic ordinaire'), null);
});

test('la categorie architecture declenche le questionnaire dedie', () => {
    const service = new TicketService({}, {}, {});

    assert.equal(service.needsArchitectureQuestionnaire({ id: 'architecture' }), true);
    assert.equal(service.needsArchitectureQuestionnaire({ id: 'Architecture' }), true);
    assert.equal(service.needsArchitectureQuestionnaire({ id: 'support' }), false);
});

test('la previsualisation du transcript reste compatible avec Discord', () => {
    const service = new TicketService({}, {}, {});
    const preview = service.buildTranscriptPreview('TRANSCRIPT SPRUNK\n'.repeat(200));

    assert.equal(preview.startsWith('```txt\n'), true);
    assert.equal(preview.endsWith('\n```'), true);
    assert.equal(preview.length <= 2000, true);
});
