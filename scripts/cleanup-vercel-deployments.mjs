import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { APPROVED_HASHES_BASE64 } from './approved-vercel-deployment-hashes.mjs';

const API = 'https://api.vercel.com';
const TIME_ZONE = 'Europe/Lisbon';
const KEEP_RECENT = 20;
const MAX_DELETE_PER_RUN = 25;

export function candidateFingerprint(items) {
  return createHash('sha256').update(items.map((item) => item.id).sort().join('\n')).digest('hex');
}

export function selectReviewedCandidates(items) {
  const bytes = Buffer.from(APPROVED_HASHES_BASE64, 'base64');
  if (bytes.length !== 248 * 8) throw new Error('Invalid reviewed deployment digest list');
  const hashes = new Set();
  for (let offset = 0; offset < bytes.length; offset += 8) {
    hashes.add(bytes.subarray(offset, offset + 8).toString('hex'));
  }
  if (hashes.size !== 248) throw new Error('Duplicate reviewed deployment digest');
  const selected = items.filter((item) => hashes.has(createHash('sha256').update(item.id).digest().subarray(0, 8).toString('hex')));
  if (selected.length !== 248) throw new Error(`Only ${selected.length} of 248 reviewed deployments remain eligible; refusing deletion.`);
  return selected;
}

function dayInLisbon(timestamp) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function deploymentTime(deployment) {
  const value = Number(deployment.createdAt ?? deployment.created);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid creation time for deployment ${deployment.uid ?? '(missing ID)'}`);
  }
  return value;
}

export function planCleanup(deployments, aliasIds, now = Date.now()) {
  if (!Array.isArray(deployments) || !Array.isArray(aliasIds)) {
    throw new Error('Deployments and alias IDs must be arrays');
  }
  const aliases = new Set(aliasIds);
  const seen = new Set();
  const sorted = deployments.map((deployment) => {
    if (typeof deployment.uid !== 'string' || !deployment.uid.startsWith('dpl_') || seen.has(deployment.uid)) {
      throw new Error('Missing or duplicate deployment ID');
    }
    seen.add(deployment.uid);
    if (deployment.target !== 'production' || deployment.state !== 'READY') {
      throw new Error(`Unexpected deployment type/state: ${deployment.uid}`);
    }
    return { ...deployment, createdAtMs: deploymentTime(deployment) };
  }).sort((a, b) => b.createdAtMs - a.createdAtMs || b.uid.localeCompare(a.uid));

  const today = dayInLisbon(now);
  const dayBefore = new Date(`${today}T12:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const previousDay = dayInLisbon(dayBefore.getTime());

  const keptDays = new Set();
  const keep = [];
  const remove = [];
  for (const [index, deployment] of sorted.entries()) {
    const day = dayInLisbon(deployment.createdAtMs);
    let reason;
    if (index < KEEP_RECENT) reason = `recent ${KEEP_RECENT}`;
    else if (aliases.has(deployment.uid)) reason = 'active alias';
    else if (day === today || day === previousDay) reason = 'current/previous day';
    else if (!keptDays.has(day)) reason = 'last deployment of day';
    if (reason) {
      keep.push({ id: deployment.uid, day, createdAt: deployment.createdAtMs, reason });
      keptDays.add(day);
    } else {
      remove.push({ id: deployment.uid, day, createdAt: deployment.createdAtMs });
    }
  }
  return { keep, remove };
}

async function requestJson(path, token, options = {}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 429 && attempt < 5) {
      const retryAfter = Number(response.headers?.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60000) : Math.min(1000 * (2 ** attempt), 30000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok) throw new Error(`Vercel API ${response.status} on ${options.method ?? 'GET'} ${path.split('?')[0]}`);
    if (options.method === 'DELETE') return null;
    return response.json();
  }
  throw new Error(`Vercel API retries exhausted on ${options.method ?? 'GET'} ${path.split('?')[0]}`);
}

async function listPages(endpoint, key, token, projectId, teamId) {
  const all = [];
  const cursors = new Set();
  let cursor;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ projectId, teamId, limit: '100' });
    if (endpoint.includes('deployments')) {
      query.set('target', 'production');
      query.set('state', 'READY');
    }
    if (cursor !== undefined) query.set('until', String(cursor));
    const data = await requestJson(`${endpoint}?${query}`, token);
    if (!Array.isArray(data?.[key]) || !data.pagination || typeof data.pagination !== 'object') {
      throw new Error(`Unexpected ${key} response; refusing partial cleanup`);
    }
    all.push(...data[key]);
    const next = data.pagination.next;
    if (next == null) return all;
    if (!Number.isSafeInteger(Number(next)) || cursors.has(String(next))) {
      throw new Error(`Invalid ${key} pagination cursor`);
    }
    cursors.add(String(next));
    cursor = next;
  }
  throw new Error(`Too many ${key} pages; refusing partial cleanup`);
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const execute = args.includes('--execute');
  const all = args.includes('--execute-all');
  const reviewed = args.includes('--execute-reviewed');
  const expectedArg = args.find((arg) => arg.startsWith('--expected-sha256='));
  const excludedArgs = args.filter((arg) => arg.startsWith('--exclude-id='));
  if (args.some((arg) => !['--execute', '--execute-all', '--execute-reviewed', '--json'].includes(arg) && !arg.startsWith('--expected-sha256=') && !arg.startsWith('--exclude-id=')) ||
      (all && reviewed) || ((all || reviewed) && (!execute || !expectedArg)) || (expectedArg && !(all || reviewed)) ||
      args.filter((arg) => arg.startsWith('--expected-sha256=')).length > 1 ||
      excludedArgs.length > 1 || (excludedArgs.length > 0 && !all) ||
      (excludedArgs.length > 0 && !/^--exclude-id=dpl_[A-Za-z0-9]+$/.test(excludedArgs[0]))) {
    throw new Error('Usage: node scripts/cleanup-vercel-deployments.mjs [--json] [--execute [--execute-reviewed|--execute-all --expected-sha256=HASH]]');
  }
  const { VERCEL_ACCESS_TOKEN: token, VERCEL_PROJECT_ID: projectId, VERCEL_TEAM_ID: teamId } = env;
  if (!token || !/^prj_[A-Za-z0-9]+$/.test(projectId ?? '') || !/^team_[A-Za-z0-9]+$/.test(teamId ?? '')) {
    throw new Error('Set VERCEL_ACCESS_TOKEN, VERCEL_PROJECT_ID (prj_...), and VERCEL_TEAM_ID (team_...)');
  }
  if (execute && env.VERCEL_ENABLE_DELETION !== 'yes') {
    throw new Error('Deletion is locked. Set VERCEL_ENABLE_DELETION=yes only after reviewing a dry run.');
  }

  const deployments = await listPages('/v7/deployments', 'deployments', token, projectId, teamId);
  if (deployments.some((deployment) => deployment.projectId && deployment.projectId !== projectId)) {
    throw new Error('Deployment response contains another project; refusing cleanup');
  }
  const aliases = await listPages('/v4/aliases', 'aliases', token, projectId, teamId);
  if (aliases.some((alias) => alias.projectId && alias.projectId !== projectId)) {
    throw new Error('Alias response contains another project; refusing cleanup');
  }
  const aliasIds = aliases.filter((alias) => !alias.deletedAt).map((alias) => alias.deploymentId ?? alias.deployment?.id);
  if (execute && aliasIds.length === 0) throw new Error('No active aliases found; refusing deletion');
  if (aliases.some((alias) => !alias.deletedAt && !alias.deploymentId && !alias.deployment?.id)) {
    throw new Error('Active alias without deployment ID; refusing cleanup');
  }
  const plan = planCleanup(deployments, aliasIds);
  const excludedId = excludedArgs[0]?.slice('--exclude-id='.length);
  if (excludedId && !plan.remove.some((item) => item.id === excludedId)) {
    throw new Error(`Excluded deployment ${excludedId} is not a current candidate; refusing deletion.`);
  }
  const approved = reviewed ? selectReviewedCandidates(plan.remove) : excludedId ? plan.remove.filter((item) => item.id !== excludedId) : plan.remove;
  const fingerprint = candidateFingerprint(approved);
  if ((all || reviewed) && fingerprint !== expectedArg.slice('--expected-sha256='.length)) {
    throw new Error(`Candidate list changed; refusing deletion. Expected ${expectedArg.slice('--expected-sha256='.length)}, got ${fingerprint}.`);
  }
  const selected = all || reviewed ? approved : plan.remove.slice(0, MAX_DELETE_PER_RUN);
  const report = {
    mode: execute ? 'execute' : 'dry-run', projectId, teamId,
    productionReady: deployments.length, activeAliases: aliasIds.length,
    kept: plan.keep.length, eligibleForDeletion: plan.remove.length,
    excludedId: excludedId ?? null, candidateSha256: fingerprint,
    candidates: plan.remove,
    selectedThisRun: selected,
  };
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.mode}: ${report.productionReady} ready production deployments; keep ${report.kept}; eligible ${report.eligibleForDeletion}; this run ${selected.length}`);
    for (const item of selected) console.log(`${item.day}  ${item.id}`);
  }
  if (!execute) return report;

  for (const item of selected) {
    // Re-read aliases immediately before every irreversible request.
    const currentAliases = await listPages('/v4/aliases', 'aliases', token, projectId, teamId);
    if (currentAliases.some((alias) => !alias.deletedAt && !alias.deploymentId && !alias.deployment?.id)) {
      throw new Error('Active alias without deployment ID; stopping');
    }
    if (currentAliases.some((alias) => !alias.deletedAt && (alias.deploymentId ?? alias.deployment?.id) === item.id)) {
      throw new Error(`Deployment ${item.id} acquired an active alias; stopping`);
    }
    await requestJson(`/v13/deployments/${encodeURIComponent(item.id)}?${new URLSearchParams({ teamId })}`, token, { method: 'DELETE' });
    console.log(`Deleted ${item.id}`);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
