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
