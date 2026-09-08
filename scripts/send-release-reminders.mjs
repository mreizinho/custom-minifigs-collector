import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

const APP_ID = 'd9dcde89-f32c-46c1-89f8-61d98a8267f1';
const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const oneSignalApiKey = process.env.ONESIGNAL_APP_API_KEY;

if (!serviceAccountText) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
if (!oneSignalApiKey) throw new Error('ONESIGNAL_APP_API_KEY is not configured.');

const serviceAccount = JSON.parse(serviceAccountText);
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const now = Timestamp.now();
const schedulingHorizon = Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);
const due = await db.collectionGroup('releaseReminders')
  .where('status', 'in', ['active', 'cancel_requested'])
  .where('remindAt', '<=', schedulingHorizon)
  .orderBy('remindAt', 'asc')
  .limit(100)
  .get();

let sent = 0;
let skipped = 0;
let failed = 0;

function idempotencyKey(path, remindAt) {
  const bytes = Buffer.from(createHash('sha256').update(`${path}:${remindAt.toMillis()}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function websiteLabel(siteName, siteUrl) {
  if (siteName) return String(siteName);
  if (!siteUrl) return 'Website not specified';
  try { return new URL(siteUrl).hostname.replace(/^www\./, ''); }
  catch { return String(siteUrl); }
}

function eventDateTimeLabel(eventStartsAt, remindAt, timeZone) {
  const eventDate = eventStartsAt?.toDate?.() || new Date(eventStartsAt);
  if (!Number.isFinite(eventDate.getTime())) return '';
  const zone = timeZone || 'UTC';
  const dayKey = date => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const eventDay = dayKey(eventDate);
  const reminderDay = dayKey(remindAt);
  const tomorrow = new Date(remindAt.getTime() + 86400000);
  const day = eventDay === reminderDay ? 'Today' : eventDay === dayKey(tomorrow) ? 'Tomorrow' : new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' }).format(eventDate);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(eventDate);
  return `${day} at ${time}`;
}

async function cancelMessage(messageId) {
  if (!messageId) return;
  const response = await fetch(`https://api.onesignal.com/notifications/${encodeURIComponent(messageId)}?app_id=${APP_ID}`, {
    method: 'DELETE',
    headers: { Authorization: `Key ${oneSignalApiKey}` }
  });
  if (!response.ok && response.status !== 404) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.errors?.join?.('; ') || result.message || `OneSignal cancellation returned ${response.status}`);
  }
}

for (const snapshot of due.docs) {
  const claimed = await db.runTransaction(async transaction => {
    const fresh = await transaction.get(snapshot.ref);
    if (!fresh.exists || !['active', 'cancel_requested'].includes(fresh.get('status'))) return null;
    const startsAt = fresh.get('eventStartsAt');
    const remindAt = fresh.get('remindAt');
    if (!startsAt || !remindAt || startsAt.toMillis() <= Date.now() || remindAt.toMillis() <= Date.now()) {
      transaction.update(snapshot.ref, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
      return null;
    }
    transaction.update(snapshot.ref, {
      status: 'sending',
      attempts: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });
    return { ...fresh.data(), previousStatus: fresh.get('status') };
  });

  if (!claimed) {
    skipped += 1;
    continue;
  }

  try {
    await cancelMessage(claimed.cancelMessageId || (claimed.previousStatus === 'cancel_requested' ? claimed.oneSignalMessageId : ''));
    if (claimed.previousStatus === 'cancel_requested') {
      await snapshot.ref.delete();
      sent += 1;
      continue;
    }
    const remindAt = claimed.remindAt.toDate();
    const scheduled = remindAt.getTime() > Date.now() + 30_000;
    const payload = {
      app_id: APP_ID,
      target_channel: 'push',
      include_aliases: { external_id: [claimed.ownerUid] },
      headings: { en: claimed.eventName || 'Drop reminder' },
      contents: { en: [websiteLabel(claimed.siteName, claimed.siteUrl), eventDateTimeLabel(claimed.eventStartsAt, remindAt, claimed.timeZone)].filter(Boolean).join('\n') },
      url: claimed.siteUrl || 'https://cmcollector.com/',
      idempotency_key: idempotencyKey(`${snapshot.ref.path}:notification-v2`, claimed.remindAt)
    };
    if (scheduled) payload.send_after = remindAt.toISOString();
    const response = await fetch('https://api.onesignal.com/notifications?c=push', {
      method: 'POST',
      headers: {
        Authorization: `Key ${oneSignalApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok || !result.id) throw new Error(result.errors?.join?.('; ') || result.message || `OneSignal returned ${response.status}`);
    await snapshot.ref.update({
      status: scheduled ? 'scheduled' : 'sent',
      sentAt: scheduled ? null : FieldValue.serverTimestamp(),
      scheduledAt: FieldValue.serverTimestamp(),
      scheduledFor: claimed.remindAt,
      oneSignalMessageId: result.id,
      cancelMessageId: '',
      lastError: '',
      updatedAt: FieldValue.serverTimestamp()
    });
    sent += 1;
  } catch (error) {
    await snapshot.ref.update({
      status: claimed.previousStatus,
      lastError: String(error.message || error),
      updatedAt: FieldValue.serverTimestamp()
    });
    failed += 1;
  }
}

console.log(JSON.stringify({ checked: due.size, processed: sent, skipped, failed }));
if (failed) process.exitCode = 1;
