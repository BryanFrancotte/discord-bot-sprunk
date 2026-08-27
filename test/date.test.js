'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseParisDate } = require('../src/utils/date');

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
