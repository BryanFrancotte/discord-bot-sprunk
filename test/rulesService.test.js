'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const RulesService = require('../src/services/RulesService');

const ROLE_ID = '123456789012345678';

function buildService(rules) {
    return new RulesService({
        config: { bot: { color: '#00ff11', footerText: 'SPRUNK' }, rules }
    });
}

function buildInteraction({ roleIds = [], addError = null } = {}) {
    const replies = [];
    const added = [];
    return {
        replies,
        added,
        member: {
            roles: {
                cache: new Set(roleIds),
                add: async roleId => {
                    if (addError) throw addError;
                    added.push(roleId);
                }
            }
        },
        reply: async payload => { replies.push(payload); }
    };
}

test('le règlement par défaut numérote chaque règle', () => {
    const embed = buildService(undefined).buildRulesEmbed().toJSON();

    assert.match(embed.title, /RÈGLEMENT/);
    assert.match(embed.description, /PRÉNOM ET NOM OBLIGATOIRE/);
    assert.match(embed.description, /1️⃣ Respectez les autres membres/);
    assert.match(embed.description, /7️⃣ Le staff se réserve/);
    assert.match(embed.description, /\*Les règles peuvent être modifiées/);
});

test('config.rules remplace les textes par défaut', () => {
    const embed = buildService({
        title: 'Nos règles',
        warning: 'Pseudo RP obligatoire.',
        items: ['Soyez corrects.', 'Pas de spam.'],
        note: ''
    }).buildRulesEmbed().toJSON();

    assert.equal(embed.title, 'Nos règles');
    assert.match(embed.description, /1️⃣ Soyez corrects\./);
    assert.match(embed.description, /2️⃣ Pas de spam\./);
    assert.doesNotMatch(embed.description, /3️⃣/);
    assert.doesNotMatch(embed.description, /\*\*/);
});

test('un règlement trop long est refusé avant l’envoi', () => {
    const service = buildService({ items: [`${'a'.repeat(1000)}`, 'b'.repeat(1000), 'c'.repeat(1000), 'd'.repeat(1000), 'e'.repeat(1000)] });

    assert.throws(() => service.buildRulesEmbed(), /4096 caractères/);
});

test('le bouton porte le libellé configuré et l’identifiant attendu', () => {
    const button = buildService({ buttonLabel: 'J’accepte' }).buildAcceptRow().toJSON().components[0];

    assert.equal(button.custom_id, 'rules:accept');
    assert.equal(button.label, 'J’accepte');
});

test('le bouton attribue le rôle membre configuré', async () => {
    const interaction = buildInteraction();

    await buildService({ memberRoleId: ROLE_ID }).acceptRules(interaction);

    assert.deepEqual(interaction.added, [ROLE_ID]);
    assert.match(interaction.replies.at(-1).content, /Merci/);
});

test('un membre ayant déjà le rôle n’est pas réattribué', async () => {
    const interaction = buildInteraction({ roleIds: [ROLE_ID] });

    await buildService({ memberRoleId: ROLE_ID }).acceptRules(interaction);

    assert.equal(interaction.added.length, 0);
    assert.match(interaction.replies.at(-1).content, /déjà accepté/);
});

test('sans rôle configuré, le bouton explique quoi configurer', async () => {
    const interaction = buildInteraction();

    await buildService(undefined).acceptRules(interaction);

    assert.equal(interaction.added.length, 0);
    assert.match(interaction.replies.at(-1).content, /rules\.memberRoleId/);
});

test('un rôle placé au-dessus de celui du bot donne un message explicite', async () => {
    const interaction = buildInteraction({ addError: Object.assign(new Error('Missing Permissions'), { code: 50013 }) });

    await buildService({ memberRoleId: ROLE_ID }).acceptRules(interaction);

    assert.match(interaction.replies.at(-1).content, /au-dessus du rôle membre/);
});

test('une erreur inattendue remonte au gestionnaire central', async () => {
    const interaction = buildInteraction({ addError: Object.assign(new Error('boom'), { code: 500 }) });

    await assert.rejects(() => buildService({ memberRoleId: ROLE_ID }).acceptRules(interaction), /boom/);
});
