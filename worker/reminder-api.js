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
  if (!response.ok && response.status !== 404) throw new Error('Could not cancel the previous reminder.');
}

async function idempotencyKey(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).slice(0, 16);
  digest[6] = (digest[6] & 15) | 64;
  digest[8] = (digest[8] & 63) | 128;
  const hex = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default {
  async fetch(request, env) {
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
      if (remindAt.getTime() > Date.now() + 30 * 86400000) return json(origin, { deferred: true });

      const payload = {
        app_id: APP_ID,
        target_channel: 'push',
        include_aliases: { external_id: [user.localId] },
        headings: { en: String(body.eventName || 'Drop reminder').slice(0, 120) },
        contents: { en: `${body.siteName || 'Release'} · ${body.eventName || 'Upcoming drop'}`.slice(0, 240) },
        url: body.siteUrl || 'https://cmcollector.com/',
        chrome_web_icon: 'https://cmcollector.com/notification-lego-head.png',
        firefox_icon: 'https://cmcollector.com/notification-lego-head.png',
        chrome_web_badge: 'https://cmcollector.com/notification-lego-head.png',
        idempotency_key: await idempotencyKey(`${user.localId}:${body.reminderId}:${remindAt.toISOString()}`)
      };
      if (remindAt.getTime() > Date.now() + 30000) payload.send_after = remindAt.toISOString();

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
