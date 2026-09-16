import assert from 'node:assert/strict';
import test from 'node:test';
import { main, planCleanup } from './cleanup-vercel-deployments.mjs';

const now = Date.parse('2026-09-16T12:00:00Z');
const deployment = (number, timestamp) => ({
  uid: `dpl_${number}`, target: 'production', state: 'READY', createdAt: Date.parse(timestamp),
});

test('keeps one completed-day release, active alias, recent 20, and current/previous days', () => {
  const recent = Array.from({ length: 20 }, (_, i) => deployment(i, `2026-09-16T${String(i).padStart(2, '0')}:00:00Z`));
  const older = [
    deployment(20, '2026-09-15T08:00:00Z'),
    deployment(21, '2026-09-15T07:00:00Z'),
    deployment(22, '2026-09-14T12:00:00Z'),
    deployment(23, '2026-09-14T11:00:00Z'),
    deployment(24, '2026-09-14T10:00:00Z'),
    deployment(25, '2026-09-13T12:00:00Z'),
    deployment(26, '2026-09-13T11:00:00Z'),
  ];
  const plan = planCleanup([...recent, ...older], ['dpl_23'], now);
  assert.deepEqual(plan.remove.map((item) => item.id), ['dpl_24', 'dpl_26']);
  assert.equal(plan.keep.find((item) => item.id === 'dpl_23').reason, 'active alias');
});

test('groups days using Lisbon time, including daylight saving time', () => {
  const recent = Array.from({ length: 20 }, (_, i) => deployment(i, `2026-09-16T${String(i).padStart(2, '0')}:00:00Z`));
  const plan = planCleanup([
    ...recent,
    deployment(20, '2026-03-28T23:30:00Z'), // March 28 in Lisbon
    deployment(21, '2026-03-28T22:30:00Z'),
    deployment(22, '2026-03-29T23:30:00Z'), // March 30 in Lisbon (WEST)
  ], [], now);
  assert.deepEqual(plan.remove.map((item) => item.id), ['dpl_21']);
  assert.equal(plan.keep.find((item) => item.id === 'dpl_22').day, '2026-03-30');
});

test('rejects incomplete or out-of-scope deployment data', () => {
  assert.throws(() => planCleanup([deployment(1, '2026-09-01T00:00:00Z'), deployment(1, '2026-09-02T00:00:00Z')], [], now), /duplicate/);
  assert.throws(() => planCleanup([{ ...deployment(1, '2026-09-01T00:00:00Z'), target: 'preview' }], [], now), /Unexpected/);
  assert.throws(() => planCleanup([{ ...deployment(1, '2026-09-01T00:00:00Z'), createdAt: undefined }], [], now), /Invalid creation/);
});

test('dry run reads API results and never sends DELETE', async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const methods = [];
  globalThis.fetch = async (url, options) => {
    methods.push(options.method ?? 'GET');
    const path = new URL(url);
    const data = path.pathname.includes('deployments')
      ? { deployments: [deployment(1, '2026-09-01T12:00:00Z')], pagination: { next: null } }
      : { aliases: [{ projectId: 'prj_test', deploymentId: 'dpl_1' }], pagination: { next: null } };
    return { ok: true, json: async () => data };
  };
  console.log = () => {};
  try {
    const result = await main([], {
      VERCEL_ACCESS_TOKEN: 'test-token',
      VERCEL_PROJECT_ID: 'prj_test',
      VERCEL_TEAM_ID: 'team_test',
    });
    assert.equal(result.mode, 'dry-run');
    assert.deepEqual(methods, ['GET', 'GET']);
    assert.equal(result.eligibleForDeletion, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});
