'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JsonStore = require('../src/services/JsonStore');

test('le stockage JSON sérialise les modifications concurrentes', async context => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sprunk-store-test-'));
    const store = new JsonStore(path.join(directory, 'store.json'), { count: 0 });

    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    await store.initialize();

    await Promise.all(Array.from({ length: 20 }, () => store.update(data => {
        data.count += 1;
    })));

    assert.deepEqual(await store.read(), { count: 20 });
});
