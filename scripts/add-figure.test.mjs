import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const code = [
  extract('function normalizedHeader(', 'function loadImageFile('),
  extract('async function appendFigureToActiveSheet(', "addFigureForm.addEventListener('submit'"),
].join('\n');

function fixture({ updatedRow = 5, duplicate = false, changeCollection = false, expectedCondition = 'New' } = {}) {
  const headers = ['#', 'Name', 'Brand', 'Value', 'Currency', 'Condition'];
  const before = [headers, ['1', 'Old figure', 'LEGO'], ['2', 'Another figure', 'LEGO'], ['4', 'Phoenix Flyer', 'LEGO']];
  const after = [headers, ...before.slice(1), ['3', 'Wolven Wingman', 'LEGO']];
  if (duplicate) after.push(['3', 'Duplicate', 'LEGO']);
  let reads = 0;
  const calls = [];
  const context = {
    activeCollection: 'Star Wars', SHEET_ID: 'test-sheet', window: { collectorFirebaseUser: 'user-1' },
    clean: value => String(value ?? '').trim(), encodeURIComponent, console,
    sheetsRequest: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes('/values/') && options.method === 'POST') {
        assert.match(url, /insertDataOption=INSERT_ROWS/);
        assert.equal(JSON.parse(options.body).values[0][0], 3);
        assert.equal(JSON.parse(options.body).values[0][5], expectedCondition);
        if (changeCollection) context.activeCollection = 'Other';
        return { json: async () => ({ updates: { updatedRange: `'Star Wars'!A${updatedRow}:E${updatedRow}`, updatedRows: 1 } }) };
      }
      if (url.includes('/values/')) return { json: async () => ({ values: reads++ ? after : before }) };
      if (url.endsWith('?fields=sheets.properties(sheetId,title)')) return { json: async () => ({ sheets: [{ properties: { title: 'Star Wars', sheetId: 7 } }] }) };
      return { json: async () => ({}) };
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { context, calls };
}

const entry = { name: 'Wolven Wingman', brand: 'LEGO', value: '10', currency: 'EUR' };

test('reuses a deleted ID, inserts after existing figures, and returns the verified row', async () => {
  const { context, calls } = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(await context.appendFigureToActiveSheet(entry))), { id: 3, sheetRow: 5, sheetCollection: 'Star Wars' });
  assert.equal(calls.filter(call => call.options.method === 'POST' && call.url.includes('/values/')).length, 1);
});

test('writes the condition selected in the add form', async () => {
  const { context } = fixture({ expectedCondition: 'Display' });
  await context.appendFigureToActiveSheet({ ...entry, condition: 'Display' });
});

test('rejects an append response that targets an existing row', async () => {
  const { context, calls } = fixture({ updatedRow: 4 });
  await assert.rejects(context.appendFigureToActiveSheet(entry), /did not confirm a new row/);
  assert.equal(calls.filter(call => call.url.endsWith(':batchUpdate')).length, 0);
});

test('rejects duplicate IDs after the write', async () => {
  const { context } = fixture({ duplicate: true });
  await assert.rejects(context.appendFigureToActiveSheet(entry), /could not be verified/);
});

test('stops if the selected collection changes while the request is in flight', async () => {
  const { context } = fixture({ changeCollection: true });
  await assert.rejects(context.appendFigureToActiveSheet(entry), /collection or Google account changed/);
});
