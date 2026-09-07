import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

const APP_ID = 'd9dcde89-f32c-46c1-89f8-61d98a8267f1';
const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const oneSignalApiKey = process.env.ONESIGNAL_APP_API_KEY;

if (!serviceAccountText) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
if (!oneSignalApiKey) throw new Error('ONESIGNAL_APP_API_KEY is not configured.');

const serviceAccount = JSON.parse(serviceAccountText);
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const now = Timestamp.now();
const due = await db.collection('releaseReminders')
  .where('status', '==', 'active')
  .where('remindAt', '<=', now)
  .orderBy('remindAt', 'asc')
  .limit(100)
  .get();

let sent = 0;
let skipped = 0;
let failed = 0;

for (const snapshot of due.docs) {
  const claimed = await db.runTransaction(async transaction => {
    const fresh = await transaction.get(snapshot.ref);
    if (!fresh.exists || fresh.get('status') !== 'active') return null;
    const startsAt = fresh.get('eventStartsAt');
    if (!startsAt || startsAt.toMillis() < Date.now() - 60 * 60 * 1000) {
      transaction.update(snapshot.ref, { status: 'expired', updatedAt: FieldValue.serverTimestamp() });
      return null;
    }
    transaction.update(snapshot.ref, {
      status: 'sending',
      attempts: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });
    return fresh.data();
  });

  if (!claimed) {
    skipped += 1;
    continue;
  }

  try {
    const response = await fetch('https://api.onesignal.com/notifications?c=push', {
      method: 'POST',
      headers: {
        Authorization: `Key ${oneSignalApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        app_id: APP_ID,
        target_channel: 'push',
        include_aliases: { external_id: [claimed.ownerUid] },
        headings: { en: claimed.eventName || 'Drop reminder' },
        contents: { en: `${claimed.siteName || 'Release'} · ${claimed.eventName || 'Upcoming drop'}` },
        url: claimed.siteUrl || 'https://cmcollector.com/'
      })
    });
    const result = await response.json();
    if (!response.ok || !result.id) throw new Error(result.errors?.join?.('; ') || result.message || `OneSignal returned ${response.status}`);
    await snapshot.ref.update({
      status: 'sent',
      sentAt: FieldValue.serverTimestamp(),
      oneSignalMessageId: result.id,
      lastError: '',
      updatedAt: FieldValue.serverTimestamp()
    });
    sent += 1;
  } catch (error) {
    await snapshot.ref.update({
      status: 'active',
      lastError: String(error.message || error),
      updatedAt: FieldValue.serverTimestamp()
    });
    failed += 1;
  }
}

console.log(JSON.stringify({ checked: due.size, sent, skipped, failed }));
if (failed) process.exitCode = 1;
