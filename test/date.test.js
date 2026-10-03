'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatParisDate, parseParisDate } = require('../src/utils/date');

test('convertit une date d’hiver Paris vers UTC', () => {
    assert.equal(parseParisDate('15/01/2027 21:00')?.toISOString(), '2027-01-15T20:00:00.000Z');
});

test('convertit une date d’été Paris vers UTC', () => {
    assert.equal(parseParisDate('15/07/2027 21:00')?.toISOString(), '2027-07-15T19:00:00.000Z');
});

test('rejette une date civile impossible', () => {
    assert.equal(parseParisDate('31/02/2027 21:00'), null);
});

test('rejette une heure inexistante au passage à l’heure d’été', () => {
    assert.equal(parseParisDate('28/03/2027 02:30'), null);
});

test('rejette un format incorrect', () => {
    assert.equal(parseParisDate('2027-07-15 21:00'), null);
});

test('formate une date au format JJ/MM/AAAA HH:mm de Paris', () => {
    assert.equal(formatParisDate(new Date('2027-01-15T20:00:00.000Z')), '15/01/2027 21:00');
    assert.equal(formatParisDate(new Date('2027-07-05T07:05:00.000Z')), '05/07/2027 09:05');
});

test('formatParisDate est l’inverse de parseParisDate', () => {
    for (const text of ['01/01/2027 00:00', '15/07/2027 21:00', '31/12/2027 23:59']) {
        assert.equal(formatParisDate(parseParisDate(text)), text);
    }
});
