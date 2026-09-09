const APP_ID = 'd9dcde89-f32c-46c1-89f8-61d98a8267f1';
const FIREBASE_PROJECT_ID = 'custom-figures-collector';
const ALLOWED_ORIGINS = new Set([
  'https://cmcollector.com',
  'https://www.cmcollector.com'
]);

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://cmcollector.com',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin'
  };
}

function json(origin, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' }
  });
}

async function publicDriveImage(request, fileId) {
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(fileId)) return new Response('Invalid image ID.', { status: 400 });
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + `/image/${fileId}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const sources = [
    `https://lh3.googleusercontent.com/d/${fileId}=w1000`,
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1000`
  ];
  for (const source of sources) {
    const upstream = await fetch(source, { redirect: 'follow' });
    const type = upstream.headers.get('Content-Type') || '';
    if (!upstream.ok || !type.startsWith('image/')) continue;
    const response = new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      }
    });
    await cache.put(cacheKey, response.clone());
    return response;
  }
  return new Response('Image unavailable.', { status: 404 });
}

async function authenticatedUser(request) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new Error('Authentication required.');
  const parts = authorization.slice(7).split('.');
  if (parts.length !== 3) throw new Error('Invalid or expired sign-in.');
  const decode = value => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))));
  const header = decode(parts[0]);
  const claims = decode(parts[1]);
  const keysResponse = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const keys = await keysResponse.json();
  const jwk = keys.keys?.find(key => key.kid === header.kid);
  if (!jwk) throw new Error('Invalid or expired sign-in.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signature = Uint8Array.from(atob(parts[2].replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
  const valid = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.aud !== FIREBASE_PROJECT_ID || claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` || !claims.sub || claims.exp <= now || claims.iat > now) {
    throw new Error('Invalid or expired sign-in.');
  }
  return { localId: claims.sub };
}

async function cancelNotification(messageId, env) {
  if (!messageId) return;
  const response = await fetch(
    `https://api.onesignal.com/notifications/${encodeURIComponent(messageId)}?app_id=${APP_ID}`,
    { method: 'DELETE', headers: { Authorization: `Key ${env.ONESIGNAL_APP_API_KEY}` } }
  );
  // OneSignal returns 400 when a notification has already been delivered or
  // can no longer be cancelled. That old message cannot interfere with the
  // replacement, so editing the event should continue normally.
  if (!response.ok && ![400, 404, 409].includes(response.status)) throw new Error('Could not cancel the previous reminder.');
}

async function idempotencyKey(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).slice(0, 16);
  digest[6] = (digest[6] & 15) | 64;
  digest[8] = (digest[8] & 63) | 128;
  const hex = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function websiteLabel(siteName, siteUrl) {
  if (siteName) return String(siteName);
  if (!siteUrl) return 'Website not specified';
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, '');
  } catch {
    return String(siteUrl);
  }
}

function eventDateTimeLabel(eventStartsAt, remindAt, timeZone) {
  const eventDate = new Date(eventStartsAt);
  if (!Number.isFinite(eventDate.getTime())) return '';
  const zone = timeZone || 'UTC';
  const dayKey = date => new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
  const eventDay = dayKey(eventDate);
  const reminderDay = dayKey(remindAt);
  const tomorrow = new Date(remindAt.getTime() + 86400000);
  const day = eventDay === reminderDay
    ? 'Today'
    : eventDay === dayKey(tomorrow)
      ? 'Tomorrow'
      : new Intl.DateTimeFormat('en-GB', {
          timeZone: zone,
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }).format(eventDate);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(eventDate);
  return `${day} at ${time}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const imageMatch = request.method === 'GET' && url.pathname.match(/^\/image\/([a-zA-Z0-9_-]+)$/);
    if (imageMatch) return publicDriveImage(request, imageMatch[1]);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'POST' || !ALLOWED_ORIGINS.has(origin)) return json(origin, { error: 'Not allowed.' }, 403);

    try {
      const user = await authenticatedUser(request);
      const body = await request.json();
      await cancelNotification(body.previousMessageId, env);

      if (body.action === 'cancel') return json(origin, { cancelled: true });
      if (body.action !== 'schedule') return json(origin, { error: 'Unknown action.' }, 400);

      const remindAt = new Date(body.remindAt);
      if (!Number.isFinite(remindAt.getTime())) return json(origin, { error: 'Invalid reminder time.' }, 400);
      const eventStartsAt = new Date(body.eventStartsAt);
      if (!Number.isFinite(eventStartsAt.getTime())) return json(origin, { error: 'Invalid event time.' }, 400);
      if (eventStartsAt.getTime() <= Date.now() || remindAt.getTime() <= Date.now()) {
        return json(origin, { expired: true });
      }
      if (remindAt.getTime() > Date.now() + 30 * 86400000) return json(origin, { deferred: true });

      const payload = {
        app_id: APP_ID,
        target_channel: 'push',
        include_aliases: { external_id: [user.localId] },
        headings: { en: String(body.eventName || 'Drop reminder').slice(0, 120) },
        contents: { en: [
          websiteLabel(body.siteName, body.siteUrl),
          eventDateTimeLabel(body.eventStartsAt, remindAt, body.timeZone)
        ].filter(Boolean).join('\n').slice(0, 240) },
        url: body.siteUrl || 'https://cmcollector.com/',
        chrome_web_icon: 'https://cmcollector.com/notification-lego-head-white.png',
        firefox_icon: 'https://cmcollector.com/notification-lego-head-white.png',
        chrome_web_badge: 'https://cmcollector.com/notification-lego-head.png?v=2',
        idempotency_key: await idempotencyKey(`${user.localId}:${body.reminderId}:${remindAt.toISOString()}:notification-v2`)
      };
      payload.send_after = remindAt.toISOString();

      const response = await fetch('https://api.onesignal.com/notifications?c=push', {
        method: 'POST',
        headers: {
          Authorization: `Key ${env.ONESIGNAL_APP_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok || !result.id) {
        throw new Error(result.errors?.join?.('; ') || result.message || 'OneSignal rejected the reminder.');
      }
      return json(origin, {
        id: result.id,
        scheduled: Boolean(payload.send_after),
        scheduledFor: remindAt.toISOString()
      });
    } catch (error) {
      return json(origin, { error: String(error.message || error) }, 400);
    }
  }
};
