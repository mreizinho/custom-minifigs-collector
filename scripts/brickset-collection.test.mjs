import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBricksetCollection, readBricksetCollection, bricksetResponse } from '../worker/brickset.js';
const rows = [
  { minifigNumber: 'SW0971', name: 'Luke', category: 'Star Wars / Star Wars Episode 4/5/6', ownedTotal: 3, ownedInSets: 1, ownedLoose: 2 },
  { minifigNumber: 'col001', name: 'Figure', category: 'Collectible Minifigures / Harry Potter', ownedTotal: 1 },
  { minifigNumber: 'sw0000', ownedTotal: 0 },
  { minifigNumber: 'SW0971', ownedTotal: 3 },
  { minifigNumber: '../unsafe', ownedTotal: 1 }
];
const notes = [{ minifigNumber: 'sw0971', notes: 'Favourite; Gift, Favourite' }];
test('all themes map to main-theme tags with stable references, quantities, and notes', () => {
  const result = normalizeBricksetCollection(rows, notes);
  assert.equal(result.figures.length, 2);
  const sw = result.figures.find(row => row.code === 'sw0971');
  assert.deepEqual(sw.tags, ['Star Wars', 'Favourite', 'Gift']);
  assert.equal(sw.ownedTotal, 3);
  assert.equal(sw.ownedInSets, 1);
  assert.equal(sw.ownedLoose, 2);
  assert.equal(sw.photoUrl, 'https://img.bricklink.com/ItemImage/MN/0/sw0971.png');
  assert.deepEqual(result.figures[0].tags, ['Collectible Minifigures']);
});
test('uses only read operations and never returns credentials', async () => {
  const methods = [], env = { BRICKSET_API_KEY: 'private-key', BRICKSET_USER_HASH: 'private-hash' };
  const result = await readBricksetCollection(env, async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('userHash'), env.BRICKSET_USER_HASH);
    methods.push(url.split('/').pop());
    return Response.json(methods.length === 1 ? { status: 'success', minifigs: rows } : { status: 'success', userMinifigNotes: notes });
  });
  assert.deepEqual(methods, ['getMinifigCollection', 'getUserMinifigNotes']);
  assert.ok(!JSON.stringify(result).includes('private-'));
});
test('keeps owned figures available when optional notes fail; rejects failed owned lookup', async () => {
  let calls = 0;
  const env = { BRICKSET_API_KEY: 'key', BRICKSET_USER_HASH: 'hash' };
  const result = await readBricksetCollection(env, async () => ++calls === 1 ? Response.json({ status: 'success', minifigs: rows }) : Response.json({ status: 'error' }));
  assert.equal(result.notesAvailable, false);
  assert.equal(result.figures.length, 2);
  await assert.rejects(readBricksetCollection(env, async () => Response.json({ status: 'error', message: 'hash' })), /could not read/);
});
test('rejects another account before looking in cache or calling Brickset', async () => {
  let accessed = false;
  const result = await bricksetResponse(new Request('https://worker/brickset'), { BRICKSET_ALLOWED_UID: 'owner' }, { localId: 'other' }, '', (origin, body, status) => Response.json(body, { status }), {
    cache: { match: () => { accessed = true; } }, fetcher: () => { accessed = true; }
  });
  assert.equal(result.status, 403);
  assert.equal(accessed, false);
});
test('owner cache is used normally; explicit refresh reads Brickset again', async () => {
  let calls = 0, written = 0;
  const cached = { source: 'brickset', figures: [] };
  const cache = { match: async key => { assert.ok(key.url.endsWith('/owner')); return Response.json(cached); }, put: async () => { written++; } };
  const env = { BRICKSET_ALLOWED_UID: 'owner', BRICKSET_API_KEY: 'key', BRICKSET_USER_HASH: 'hash' };
  const json = (origin, data) => Response.json(data);
  const fetcher = async url => { calls++; return Response.json(url.endsWith('getMinifigCollection') ? { status: 'success', minifigs: rows } : { status: 'success', userMinifigNotes: [] }); };
  const request = refresh => new Request('https://worker/brickset', { method: 'POST', body: JSON.stringify({ refresh }) });
  await bricksetResponse(request(false), env, { localId: 'owner' }, '', json, { cache, fetcher });
  assert.equal(calls, 0);
  await bricksetResponse(request(true), env, { localId: 'owner' }, '', json, { cache, fetcher });
  assert.equal(calls, 2); assert.equal(written, 1);
});
