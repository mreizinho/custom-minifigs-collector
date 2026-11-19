// Startup only uses the authenticated backend. A Google window requires a click.
(() => {
  const endpoint = 'https://cmcollector-reminders.mreizinho.workers.dev/google/access';
  const clientId = '725550496124-u8ofih3mkl5mcq1r7vp270r6ulk7algb.apps.googleusercontent.com';
  let pendingRefresh;
  async function request(body) {
    if (!window.collectorGetIdToken) throw Object.assign(Error('Sign in with Google in Settings first.'), { code: 'google_sign_in_required' });
    const uid = window.collectorFirebaseUser;
    const token = await window.collectorGetIdToken();
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const result = await response.json();
    if (uid !== window.collectorFirebaseUser) throw Error('The signed-in account changed. Please try again.');
    if (!response.ok) {
      if (result.code === 'google_reconnect_required') window.dispatchEvent(new CustomEvent('collector-google-access-required'));
      throw Object.assign(Error(result.error || 'Google access is unavailable.'), { code: result.code });
    }
    if (result.access_token) window.dispatchEvent(new CustomEvent('collector-google-access-ready'));
    return result;
  }
  window.collectorGoogleAccess = {
    refresh({ force = false } = {}) {
      if (!pendingRefresh) pendingRefresh = request({ action: 'refresh', force }).finally(() => { pendingRefresh = null; });
      return pendingRefresh;
    },
    connect() {
      // Deliberately no refresh/fetch before requestCode: preserve the click gesture.
      return new Promise((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) return reject(Error('Google authorization is still loading. Please try again.'));
        const uid = window.collectorFirebaseUser;
        if (!uid) return reject(Error('Sign in with Google in Settings first.'));
        const client = window.google.accounts.oauth2.initCodeClient({
          client_id: clientId, scope: 'https://www.googleapis.com/auth/drive.file openid',
          include_granted_scopes: true, ux_mode: 'popup',
          callback: response => {
            if (uid !== window.collectorFirebaseUser) return reject(Error('The signed-in account changed. Please try again.'));
            if (response.error || !response.code) return reject(Error(response.error_description || response.error || 'Google authorization was cancelled.'));
            request({ action: 'connect', code: response.code }).then(resolve, reject);
          },
          error_callback: error => reject(Error(error.message || error.type || 'Google authorization was cancelled.'))
        });
        client.requestCode();
      });
    },
    disconnect: () => request({ action: 'disconnect' })
  };
})();
