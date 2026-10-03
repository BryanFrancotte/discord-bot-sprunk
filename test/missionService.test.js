'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MissionService = require('../src/services/MissionService');

test('enqueueReaction serialise les taches pour un meme message', async () => {
    const service = new MissionService({}, {});
    const order = [];

    await Promise.all([
        service.enqueueReaction('msg-1', async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            order.push('a');
        }),
        service.enqueueReaction('msg-1', async () => {
            order.push('b');
        })
    ]);

    assert.deepEqual(order, ['a', 'b']);
});

test('enqueueReaction traite des messages differents en parallele', async () => {
    const service = new MissionService({}, {});
    const start = Date.now();

    await Promise.all([
        service.enqueueReaction('msg-1', () => new Promise(resolve => setTimeout(resolve, 50))),
        service.enqueueReaction('msg-2', () => new Promise(resolve => setTimeout(resolve, 50)))
    ]);

    assert.ok(Date.now() - start < 90, 'les deux messages doivent être traités en parallèle');
});

test('enqueueReaction continue apres une tache en echec', async () => {
    const service = new MissionService({}, {});
    const order = [];

    await Promise.allSettled([
        service.enqueueReaction('msg-1', async () => {
            throw new Error('échec volontaire');
        }),
        service.enqueueReaction('msg-1', async () => {
            order.push('ok');
        })
    ]);

    assert.deepEqual(order, ['ok']);
    assert.equal(service.reactionQueues.size, 0);
});

test('l’embed et le bouton Modifier d’une mission sont construits depuis l’enregistrement', () => {
    const service = new MissionService({ config: { bot: { color: '#00ff11', missionNotificationRoleId: '' } } }, {});
    const embed = service.buildEmbed({
        title: 'Convoi',
        description: 'Escorter le camion',
        location: 'Entrepôt',
        timestamp: Date.parse('2027-07-15T19:00:00Z'),
        maxParticipants: 0
    }).toJSON();

    assert.equal(embed.title, '📋 Mission : Convoi | STAFF');
    assert.match(embed.description, /\*\*Date :\*\* 15\/07\/2027 21:00/);
    assert.match(embed.description, /\*\*Places :\*\* Illimité/);
    assert.doesNotMatch(embed.description, /Notification/);

    const [row] = service.buildComponents().map(component => component.toJSON());
    assert.equal(row.components[0].custom_id, 'mission:edit');
});
