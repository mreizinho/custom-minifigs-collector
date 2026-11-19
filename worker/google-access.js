// Refresh tokens stay encrypted in Worker storage, never in browser settings.
const CLIENT_ID = '725550496124-u8ofih3mkl5mcq1r7vp270r6ulk7algb.apps.googleusercontent.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const encoder = new TextEncoder();
const fail = (message, code, status = 400) => Object.assign(new Error(message), { code, status });
async function encryptionKey(env) {
  const bytes = Uint8Array.from(atob(env.GOOGLE_TOKEN_ENCRYPTION_KEY), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(value, uid, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(uid) }, await encryptionKey(env), encoder.encode(JSON.stringify(value)));
  return JSON.stringify({ iv: btoa(String.fromCharCode(...iv)), data: btoa(String.fromCharCode(...new Uint8Array(data))) });
}
async function unseal(value, uid, env) {
  const record = JSON.parse(value);
  const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(record.iv), additionalData: encoder.encode(uid) }, await encryptionKey(env), decode(record.data));
  return JSON.parse(new TextDecoder().decode(data));
}
async function exchange(parameters, env) {
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, ...parameters }) });
  const data = await response.json();
  if (!response.ok) {
    if (data.error === 'invalid_grant') throw fail('Reconnect Google Drive to continue.', 'google_reconnect_required', 401);
    throw fail('Google access could not be renewed. Please try again.', 'google_temporarily_unavailable', 503);
  }
  if (!data.access_token) throw fail('Google did not return an access token.', 'google_temporarily_unavailable', 503);
  return data;
}
export async function googleAccessResponse(request, env, user, origin, json) {
  const reply = (data, status = 200) => {
    const response = json(origin, data, status);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  };
  if (!env.GOOGLE_CONNECTIONS || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_TOKEN_ENCRYPTION_KEY) return reply({ error: 'Background Google access is not configured yet.', code: 'google_not_configured' }, 503);
  // The caller's verified Firebase Google identity must match the authorized Google account.
  if (!user.googleId) return reply({ error: 'Sign in with Google in Settings first.', code: 'google_sign_in_required' }, 401);
  const key = `google:${user.localId}`;
  try {
    const body = await request.json();
    if (body.action === 'disconnect') {
      const stored = await env.GOOGLE_CONNECTIONS.get(key);
      if (stored) {
        const connection = await unseal(stored, user.localId, env);
        // Delete locally even if Google is temporarily unreachable.
        await env.GOOGLE_CONNECTIONS.delete(key);
        try { await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: connection.refreshToken }) }); } catch {}
      }
      return reply({ disconnected: true });
    }
    if (body.action !== 'connect' && body.action !== 'refresh') return reply({ error: 'Unknown Google access action.' }, 400);
    let connection;
    if (body.action === 'connect') {
      if (typeof body.code !== 'string' || !body.code || body.code.length > 4096) return reply({ error: 'Invalid authorization code.' }, 400);
      const token = await exchange({ code: body.code, grant_type: 'authorization_code', redirect_uri: origin }, env);
      if (token.scope && !token.scope.split(/\s+/).includes('https://www.googleapis.com/auth/drive.file')) throw fail('Approve Google Drive access to connect your collection.', 'google_reconnect_required', 401);
      const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!profileResponse.ok) throw fail('Could not verify the connected Google account.', 'google_temporarily_unavailable', 503);
      const profile = await profileResponse.json();
      if (profile.sub !== user.googleId) throw fail('Choose the same Google account you used to sign in to Collector.', 'google_account_mismatch', 403);
      const stored = await env.GOOGLE_CONNECTIONS.get(key);
      const previous = stored ? await unseal(stored, user.localId, env) : null;
      const refreshToken = token.refresh_token || (previous?.googleId === user.googleId ? previous.refreshToken : '');
      if (!refreshToken) throw fail('Approve Google Drive access again to enable background renewal.', 'google_reconnect_required', 401);
      connection = { refreshToken, googleId: profile.sub, accessToken: token.access_token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 };
      await env.GOOGLE_CONNECTIONS.put(key, await seal(connection, user.localId, env));
    } else {
      const stored = await env.GOOGLE_CONNECTIONS.get(key);
      if (!stored) throw fail('Connect Google Drive once to enable background access.', 'google_reconnect_required', 401);
      connection = await unseal(stored, user.localId, env);
      if (connection.googleId !== user.googleId) throw fail('Reconnect Google Drive to continue.', 'google_reconnect_required', 401);
      if (body.force || connection.expiresAt <= Date.now() + 60000) {
        let token;
        try { token = await exchange({ refresh_token: connection.refreshToken, grant_type: 'refresh_token' }, env); }
        catch (error) {
          if (error.code === 'google_reconnect_required') await env.GOOGLE_CONNECTIONS.delete(key);
          throw error;
        }
        connection = { ...connection, refreshToken: token.refresh_token || connection.refreshToken, accessToken: token.access_token, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 };
        await env.GOOGLE_CONNECTIONS.put(key, await seal(connection, user.localId, env));
      }
    }
    return reply({ access_token: connection.accessToken, expires_in: Math.max(0, Math.floor((connection.expiresAt - Date.now()) / 1000)) });
  } catch (error) {
    return reply({ error: error.code ? error.message : 'Google access is temporarily unavailable. Please try again.', code: error.code || 'google_temporarily_unavailable' }, error.status || 503);
  }
}
