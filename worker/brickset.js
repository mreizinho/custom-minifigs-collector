// Brickset credentials are Worker secrets. Only normalized collection data leaves this module.
export async function readBricksetCollection(env, fetcher = fetch) {
  if (!env.BRICKSET_API_KEY || !env.BRICKSET_USER_HASH) throw Error('Brickset connection is not configured.');
  async function get(method, extra = {}) {
    const response = await fetcher(`https://brickset.com/api/v3.asmx/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ apiKey: env.BRICKSET_API_KEY, userHash: env.BRICKSET_USER_HASH, ...extra }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw Error(`Brickset is unavailable (HTTP ${response.status}).`);
    let data;
    try { data = await response.json(); } catch { throw Error('Brickset returned an invalid response.'); }
    if (data.status !== 'success') throw Error('Brickset could not read the collection. Check the saved connection credentials.');
    return data;
  }
  const owned = await get('getMinifigCollection', { params: JSON.stringify({ owned: 1 }) });
  if (!Array.isArray(owned.minifigs)) throw Error('Brickset returned an invalid minifigure list.');
  // Notes are optional: a notes outage must not make the owned collection disappear.
  let notes = [], notesAvailable = true;
  try {
    const result = await get('getUserMinifigNotes');
    if (!Array.isArray(result.userMinifigNotes)) throw Error('Missing notes.');
    notes = result.userMinifigNotes;
  } catch { notesAvailable = false; }
  return normalizeBricksetCollection(owned.minifigs, notes, { notesAvailable });
}

export function normalizeBricksetCollection(rows, notes = [], { notesAvailable = true } = {}) {
  const notesByCode = new Map(notes.map(row => [String(row.minifigNumber).toLowerCase(), String(row.notes || '').trim()]));
  const seen = new Set(), figures = [];
  const quantity = value => Math.max(0, Math.floor(Number(value) || 0));
  for (const row of rows) {
    const code = String(row.minifigNumber || '').trim().toLowerCase();
    const ownedTotal = quantity(row.ownedTotal);
    if (!/^[a-z0-9_-]+$/.test(code) || !ownedTotal || seen.has(code)) continue;
    seen.add(code);
    const category = String(row.category || '').trim(), theme = category.split(' / ')[0].trim();
    const note = notesByCode.get(code) || '';
    const tags = [...new Set([theme, ...note.split(/[,;|\r\n]+/).map(tag => tag.trim())].filter(Boolean))];
    figures.push({ code, name: String(row.name || code), category, theme, tags, notes: note,
      ownedTotal, ownedInSets: quantity(row.ownedInSets), ownedLoose: quantity(row.ownedLoose),
      photoUrl: `https://img.bricklink.com/ItemImage/MN/0/${encodeURIComponent(code)}.png` });
  }
  figures.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  return { source: 'brickset', fetchedAt: new Date().toISOString(), notesAvailable, figures };
}

export async function bricksetResponse(request, env, user, origin, json, { cache = caches.default, fetcher = fetch } = {}) {
  if (!env.BRICKSET_ALLOWED_UID || user.localId !== env.BRICKSET_ALLOWED_UID) return json(origin, { error: 'Brickset is not connected for this account.' }, 403);
  const body = await request.json();
  const key = new Request(`${new URL(request.url).origin}/brickset-cache/v1/${encodeURIComponent(user.localId)}`);
  if (body.refresh !== true) {
    const cached = await cache.match(key);
    if (cached) return json(origin, await cached.json());
  }
  const result = await readBricksetCollection(env, fetcher);
  await cache.put(key, new Response(JSON.stringify(result), { headers: { 'Cache-Control': 'max-age=900' } }));
  return json(origin, result);
}
