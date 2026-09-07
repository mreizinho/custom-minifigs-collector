import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  browserLocalPersistence,
  getRedirectResult,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDUOiBJMfjHyFISy_U7rA7ldKKnoZ05QvQ',
  authDomain: 'custom-figures-collector.firebaseapp.com',
  projectId: 'custom-figures-collector',
  storageBucket: 'custom-figures-collector.firebasestorage.app',
  messagingSenderId: '725550496124',
  appId: '1:725550496124:web:6e2910da4ee2f60bcc8cf9'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
window.collectorFirebaseServices = { auth, db };
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.file');
const GUEST_SPREADSHEET_ID = '1rDpFScTbHWIG3TEUatUNFVX7E68CoOmcgoDRQmrlwZE';
const GUEST_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${GUEST_SPREADSHEET_ID}/`;
const GUEST_COLLECTIONS = ['Star Wars'];
const ignoredKeys = new Set(['minifig-exchange-rates', 'minifig-google-client-id', 'minifig-firebase-user-id']);
const locallyProtectedKeys = new Set(['minifig-custom-tags', 'minifig-custom-tag-vocabulary']);
const isCloudSettingKey = key => String(key).startsWith('minifig-') && !String(key).startsWith('minifig-theme') && !ignoredKeys.has(String(key));
const nativeSetItem = Storage.prototype.setItem;
const nativeRemoveItem = Storage.prototype.removeItem;
let currentUser = null;
let currentUserPremium = false;
let remoteFingerprint = '';
let saveTimer = 0;
let applyingRemote = false;
let settingsBaseline = null;
let pendingGoogleAccessToken = '';
let authActionPending = false;
let deferGuestReloadUntilSettingsClose = false;
let cloudSyncPaused = false;
let authStateRevision = 0;
let promptOnNextUserConnection = false;
let pendingCloudSettings = null;
// Premium licensing has not launched yet. Keep the entitlement implementation
// available, but grant the current product to every authenticated Google user.
const PREMIUM_ENTITLEMENTS_ENABLED = false;
const REDIRECT_SIGN_IN_KEY = 'collector-google-redirect-pending';
const useRedirectSignIn = false;

async function hasPremiumAccess(user) {
  if (!user) return false;
  const email = String(user.email || '').trim().toLowerCase();
  await setDoc(doc(db, 'premiumProfiles', user.uid), {
    uid: user.uid,
    email,
    displayName: user.displayName || '',
    lastSeenAt: serverTimestamp()
  }, { merge: true });
  if (user.uid === 'rh8WrITlLTXrsDj5mbJHzA1D4Bk2') return true;
  const snapshot = await getDoc(doc(db, 'premiumEntitlements', user.uid));
  const entitlement = snapshot.data() || {};
  return snapshot.exists() && entitlement.status === 'active' && entitlement.licenseType === 'lifetime';
}

async function findCollectorSpreadsheet(accessToken) {
  if (!accessToken) return undefined;
  const query = encodeURIComponent("(name = 'CMCollectorDB' or name = 'Custom Minifigs Collector') and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink,modifiedTime)&orderBy=modifiedTime desc&pageSize=10`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    console.warn('Could not check Google Drive for an existing collection spreadsheet.', response.status);
    return undefined;
  }
  const files = (await response.json()).files || [];
  return files.find(file => file.name === 'CMCollectorDB') || files[0] || null;
}

function cachedGoogleAccessToken() {
  try {
    const cached = JSON.parse(sessionStorage.getItem('collector-sheets-access-token') || 'null');
    return cached?.token && cached.expiresAt > Date.now() + 60000 ? cached.token : '';
  } catch {
    return '';
  }
}

function announceGoogleAuth(user, accessToken = '', premium = currentUserPremium) {
  window.collectorFirebaseAuthenticatedUser = user?.uid || '';
  window.collectorFirebaseUser = user && premium ? user.uid : '';
  window.collectorPremiumUser = Boolean(user && premium);
  window.dispatchEvent(new CustomEvent('collector-google-auth', {
    detail: { uid: user && premium ? user.uid : '', signedInUid: user?.uid || '', email: user?.email || '', premium: Boolean(user && premium), accessToken: premium ? accessToken : '' }
  }));
}

function spreadsheetIdFromValue(value = '') {
  const match = String(value).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match?.[1] || (/^[a-zA-Z0-9_-]{20,}$/.test(String(value).trim()) ? String(value).trim() : '');
}

function normalizeSpreadsheetSettings(settings = {}) {
  const normalized = { ...settings };
  const savedUrl = normalized['minifig-spreadsheet-url'] || '';
  const spreadsheetId = spreadsheetIdFromValue(savedUrl) || spreadsheetIdFromValue(normalized['minifig-spreadsheet-id']);
  if (spreadsheetId) {
    normalized['minifig-spreadsheet-id'] = spreadsheetId;
    normalized['minifig-spreadsheet-url'] = savedUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/`;
  }
  return normalized;
}

function stageRestoredSpreadsheet(settings = {}) {
  const normalized = normalizeSpreadsheetSettings(settings);
  const spreadsheetId = normalized['minifig-spreadsheet-id'];
  if (!spreadsheetId) return;
  sessionStorage.setItem('collector-restored-spreadsheet-id', spreadsheetId);
  sessionStorage.setItem('collector-restored-spreadsheet-url', normalized['minifig-spreadsheet-url'] || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/`);
}

function collectSettings() {
  const settings = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (isCloudSettingKey(key)) {
      settings[key] = localStorage.getItem(key);
    }
  }
  return normalizeSpreadsheetSettings(settings);
}

function fingerprint(settings) {
  return JSON.stringify(Object.keys(settings).sort().map(key => [key, settings[key]]));
}

function status(message, error = false) {
  const target = document.querySelector('#firebaseStatus');
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('error', error);
}

function applySettings(settings) {
  settings = normalizeSpreadsheetSettings(settings);
  applyingRemote = true;
  try {
    const remoteKeys = new Set(Object.keys(settings || {}));
    const localKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (isCloudSettingKey(key)) localKeys.push(key);
    }
    localKeys.filter(key => !remoteKeys.has(key) && !locallyProtectedKeys.has(key)).forEach(key => nativeRemoveItem.call(localStorage, key));
    Object.entries(settings || {}).forEach(([key, value]) => {
      if (isCloudSettingKey(key) && typeof value === 'string') {
        nativeSetItem.call(localStorage, key, value);
      }
    });
  } finally {
    applyingRemote = false;
  }
}

async function saveNow(force = false) {
  const authenticatedUser = auth.currentUser || currentUser;
  if (!authenticatedUser || !currentUserPremium) {
    if (force) throw new Error(authenticatedUser ? 'A premium license is required before uploading.' : 'Google sign-in is not active. Sign in again before uploading.');
    return;
  }
  if (applyingRemote || (cloudSyncPaused && !force)) return;
  const settings = collectSettings();
  const nextFingerprint = fingerprint(settings);
  if (!force && nextFingerprint === remoteFingerprint) return;
  await setDoc(doc(db, 'users', authenticatedUser.uid), {
    settings,
    spreadsheet: {
      id: settings['minifig-spreadsheet-id'] || '',
      url: settings['minifig-spreadsheet-url'] || ''
    },
    email: authenticatedUser.email || '',
    updatedAt: serverTimestamp()
  }, { merge: true });
  remoteFingerprint = nextFingerprint;
  status(`Synced as ${authenticatedUser.email || 'Google user'}.`);
}

function scheduleSave() {
  if (!(auth.currentUser || currentUser) || !currentUserPremium || applyingRemote) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveNow().catch(error => status(`Sync failed: ${error.message}`, true)), 700);
}

Storage.prototype.setItem = function patchedSetItem(key, value) {
  nativeSetItem.call(this, key, value);
  if (this === localStorage && isCloudSettingKey(key)) scheduleSave();
};

Storage.prototype.removeItem = function patchedRemoveItem(key) {
  nativeRemoveItem.call(this, key);
  if (this === localStorage && isCloudSettingKey(key)) scheduleSave();
};

function renderAccount(user, premium = currentUserPremium) {
  const button = document.querySelector('#firebaseAuth');
  if (!button) return;
  button.innerHTML = `<span class="material-symbols-rounded">${user ? 'logout' : 'login'}</span>${user ? 'Sign out' : 'Sign in'}`;
  button.setAttribute('aria-pressed', String(Boolean(user)));
  document.querySelectorAll('[data-firebase-required]').forEach(control => { control.disabled = !user || !premium; });
  status(user ? premium ? `Signed in as ${user.email || 'Google user'} · Premium access enabled.` : `Signed in as ${user.email || 'Google user'}.` : 'Demo mode. Sign in with Google to find or create your personal collection spreadsheet.');
}

function chooseInitialSyncDirection(hasRemoteSettings) {
  let dialog = document.querySelector('#syncDirectionDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'syncDirectionDialog';
    dialog.className = 'sync-direction-dialog';
    dialog.setAttribute('aria-labelledby', 'syncDirectionTitle');
    dialog.innerHTML = `
      <div class="sync-direction-copy">
        <h2 id="syncDirectionTitle">Choose sync direction</h2>
        <p>This is the first sign-in for this Google account on this browser. Choose which settings should be kept.</p>
        <div class="sync-direction-actions">
          <button type="button" data-sync-direction="upload">
            <span class="material-symbols-rounded">cloud_upload</span>
            <span><strong>Save Config</strong><small>Save this device's current settings to the cloud</small></span>
          </button>
          <button type="button" data-sync-direction="download">
            <span class="material-symbols-rounded">cloud_download</span>
            <span><strong>Load Config</strong><small>Replace this device's settings with the cloud copy</small></span>
          </button>
        </div>
      </div>`;
    document.body.append(dialog);
  }
  const download = dialog.querySelector('[data-sync-direction="download"]');
  download.disabled = !hasRemoteSettings;
  download.title = hasRemoteSettings ? '' : 'No cloud settings are available yet';
  dialog.querySelector('.sync-direction-copy > p').textContent = hasRemoteSettings
    ? 'This is the first sign-in for this Google account on this browser. Choose which settings should be kept.'
    : 'No saved configuration exists for this account yet. Use Save Config to create one.';
  dialog.showModal();
  return new Promise(resolve => {
    dialog.oncancel = event => event.preventDefault();
    dialog.querySelectorAll('[data-sync-direction]').forEach(button => {
      button.onclick = () => {
        if (button.disabled) return;
        dialog.close();
        resolve(button.dataset.syncDirection);
      };
    });
  });
}

function installSettingsUi() {
  const pickerButton = document.querySelector('#chooseSpreadsheet');
  const spreadsheetField = document.querySelector('.settings-spreadsheet-field');
  if (pickerButton) {
    pickerButton.setAttribute('aria-label', 'Open spreadsheet');
    pickerButton.title = 'Open spreadsheet';
    pickerButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">table_view</span>';
    if (spreadsheetField) spreadsheetField.append(pickerButton);
  }
  const saveSpreadsheet = document.querySelector('#saveSpreadsheet');
  const saveCollections = document.querySelector('#saveCollections');
  if (saveSpreadsheet) saveSpreadsheet.hidden = true;
  if (saveCollections) saveCollections.hidden = true;
  const section = document.querySelector('.google-settings');
  if (!section) return;
  section.innerHTML = `
    <div class="google-settings-heading"><h3>Google Account</h3></div>
    <input id="googleClientId" type="hidden">
    <button type="button" id="connectGoogle" hidden></button>
    <button type="button" id="saveGoogleClient" hidden></button>
    <button type="button" id="saveOnline" hidden></button>
    <button type="button" id="loadOnline" hidden></button>
    <button type="button" id="disconnectGoogle" hidden></button>
    <p>Use your Google Account to backup, restore and sync your configuration across multiple devices. Choose Save to store this device’s configuration, or Load to restore a saved configuration.</p>
    <p class="settings-save-warning"><span class="material-symbols-rounded" aria-hidden="true">warning</span><span><strong>Important:</strong> After adding or deleting custom tags, choose Save to back up those changes to your Google Account.</span></p>
    <div class="google-settings-actions settings-account-actions">
      <button type="button" id="firebaseAuth"><span class="material-symbols-rounded">login</span>Sign in</button>
      <button type="button" id="firebaseUpload" data-firebase-required><span class="material-symbols-rounded">save</span>Save</button>
      <button type="button" id="firebaseDownload" data-firebase-required><span class="material-symbols-rounded">folder_open</span>Load</button>
    </div>
    <p id="firebaseStatus" class="settings-status" role="status" aria-live="polite"></p>`;
  if (pickerButton) section.querySelector('.google-settings-heading')?.append(pickerButton);
  let settingsFooter = document.querySelector('.settings-footer');
  if (!settingsFooter) {
    settingsFooter = document.createElement('div');
    settingsFooter.className = 'settings-footer';
    settingsFooter.innerHTML = '<button type="button" id="applySettings" disabled><span class="material-symbols-rounded">check</span>Apply</button>';
    document.querySelector('.settings-copy').append(settingsFooter);
  }
  document.querySelector('#firebaseAuth').addEventListener('click', async () => {
    if (authActionPending) return;
    authActionPending = true;
    document.querySelector('#firebaseAuth').disabled = true;
    try {
      if (auth.currentUser) {
        deferGuestReloadUntilSettingsClose = Boolean(document.querySelector('#settingsDialog')?.open);
        await signOut(auth);
      } else {
        promptOnNextUserConnection = true;
        if (useRedirectSignIn) {
          sessionStorage.setItem(REDIRECT_SIGN_IN_KEY, '1');
          await signInWithRedirect(auth, provider);
          return;
        }
        const result = await signInWithPopup(auth, provider);
        pendingGoogleAccessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken || '';
        // onAuthStateChanged may finish before the popup promise resolves. Do not
        // overwrite that completed connection with a temporary signed-out event;
        // only publish here when connectUser has already granted app access.
        if (currentUser?.uid === result.user.uid && currentUserPremium) {
          announceGoogleAuth(result.user, pendingGoogleAccessToken, true);
        }
      }
    } catch (error) {
      promptOnNextUserConnection = false;
      const message = error.code === 'auth/popup-blocked'
        ? 'The sign-in popup was blocked. Allow popups for this site and try again.'
        : error.code === 'auth/cancelled-popup-request'
          ? 'Google sign-in is already opening. Please wait for it to finish.'
        : error.code === 'auth/unauthorized-domain'
          ? 'This website is not listed in Firebase Authentication authorized domains.'
          : error.message;
      status(message, true);
    } finally {
      authActionPending = false;
      renderAccount(auth.currentUser, currentUserPremium);
      document.querySelector('#firebaseAuth').disabled = false;
    }
  });
  document.querySelector('#firebaseUpload').addEventListener('click', async () => {
    try {
      status('Saving configuration…');
      const expectedSettings = collectSettings();
      await saveNow(true);
      const verification = await getDoc(doc(db, 'users', auth.currentUser.uid));
      const savedSettings = settingsFromRemoteData(verification.data());
      if (!savedSettings || savedSettings['minifig-spreadsheet-id'] !== expectedSettings['minifig-spreadsheet-id'] || savedSettings['minifig-spreadsheet-url'] !== expectedSettings['minifig-spreadsheet-url']) {
        throw new Error('The spreadsheet configuration could not be verified after upload.');
      }
      status('Config saved');
    } catch (error) {
      status(`Save failed: ${error.message}`, true);
    }
  });
  document.querySelector('#firebaseDownload').addEventListener('click', async () => {
    try {
      status('Loading saved configuration…');
      const snapshot = await getDoc(doc(db, 'users', auth.currentUser.uid));
      const settings = settingsFromRemoteData(snapshot.data());
      if (!settings) return status('No cloud settings were found for this account.', true);
      remoteFingerprint = fingerprint(settings);
      pendingCloudSettings = settings;
      window.dispatchEvent(new CustomEvent('collector-config-staged', { detail: { settings } }));
      status('Config loaded. Review the settings, then choose Apply and Close.');
    } catch (error) {
      status(`Load failed: ${error.message}`, true);
    }
  });
  document.querySelector('#applySettings')?.addEventListener('click', () => {
    if (!pendingCloudSettings) return;
    const spreadsheetValue = document.querySelector('#spreadsheetUrl')?.value?.trim() || '';
    const spreadsheetId = spreadsheetIdFromValue(spreadsheetValue) || pendingCloudSettings['minifig-spreadsheet-id'] || '';
    const collections = (document.querySelector('#collectionNames')?.value || '').split(/[\n,;]+/).map(value => value.trim()).filter(Boolean);
    const mergedSettings = {
      ...pendingCloudSettings,
      'minifig-spreadsheet-id': spreadsheetId,
      'minifig-spreadsheet-url': spreadsheetValue || pendingCloudSettings['minifig-spreadsheet-url'] || '',
      'minifig-collections': JSON.stringify(collections),
      'minifig-max-columns': document.querySelector('#desktopMaxColumns')?.value || pendingCloudSettings['minifig-max-columns'] || '5'
    };
    stageRestoredSpreadsheet(mergedSettings);
    applySettings(mergedSettings);
    pendingCloudSettings = null;
    status('Config applied');
    setTimeout(() => location.reload(), 350);
  });
  document.querySelector('#settingsToggle')?.addEventListener('click', () => {
    pendingCloudSettings = null;
    renderAccount(auth.currentUser);
  });
  renderAccount(auth.currentUser);
  if (auth.currentUser) announceGoogleAuth(auth.currentUser, '', false);
}

function settingsFromRemoteData(data = {}) {
  let settings = (data.settings || data.spreadsheet?.id)
    ? Object.fromEntries(Object.entries(data.settings || {}).filter(([key]) => isCloudSettingKey(key)))
    : null;
  if (!settings) return null;
  settings = normalizeSpreadsheetSettings(settings);
  const settingsSpreadsheetId = settings['minifig-spreadsheet-id'] || '';
  const dedicatedSpreadsheetId = spreadsheetIdFromValue(data.spreadsheet?.url) || spreadsheetIdFromValue(data.spreadsheet?.id);
  const dedicatedIsPersonal = dedicatedSpreadsheetId && dedicatedSpreadsheetId !== GUEST_SPREADSHEET_ID;
  const settingsIsPersonal = settingsSpreadsheetId && settingsSpreadsheetId !== GUEST_SPREADSHEET_ID;
  if ((!settingsSpreadsheetId || (!settingsIsPersonal && dedicatedIsPersonal)) && dedicatedSpreadsheetId) {
    settings['minifig-spreadsheet-id'] = dedicatedSpreadsheetId;
    settings['minifig-spreadsheet-url'] = data.spreadsheet.url || `https://docs.google.com/spreadsheets/d/${dedicatedSpreadsheetId}/`;
  }
  return normalizeSpreadsheetSettings(settings);
}

function confirmCloudSettingsDownload(user, settings) {
  let dialog = document.querySelector('#cloudConfigDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'cloudConfigDialog';
    dialog.className = 'sync-direction-dialog';
    dialog.setAttribute('aria-labelledby', 'cloudConfigTitle');
    dialog.innerHTML = `
      <div class="sync-direction-copy">
        <h2 id="cloudConfigTitle">Saved configuration found</h2>
        <p></p>
        <div class="sync-direction-actions">
          <button type="button" data-cloud-choice="keep">
            <span class="material-symbols-rounded">devices</span>
            <span><strong>Keep current</strong><small>Continue with the current local or demo configuration</small></span>
          </button>
          <button type="button" data-cloud-choice="download">
            <span class="material-symbols-rounded">cloud_download</span>
            <span><strong>Load Config</strong><small>Replace local settings with the saved cloud configuration</small></span>
          </button>
        </div>
      </div>`;
    document.body.append(dialog);
  }
  dialog.querySelector('p').textContent = `A saved configuration was found for ${user.email || 'this Google account'}. Do you want to load it?`;
  const settingsDialog = document.querySelector('#settingsDialog');
  if (settingsDialog?.open) settingsDialog.close();
  dialog.showModal();
  return new Promise(resolve => {
    let settled = false;
    const finish = choice => {
      if (settled) return;
      settled = true;
      dialog.close();
      resolve(choice === 'download');
    };
    dialog.oncancel = event => {
      event.preventDefault();
      finish('keep');
    };
    dialog.querySelectorAll('[data-cloud-choice]').forEach(button => {
      button.onclick = () => finish(button.dataset.cloudChoice);
    });
  });
}

async function connectUser(user) {
  const revision = ++authStateRevision;
  const shouldOfferCloudDownload = Boolean(user && promptOnNextUserConnection);
  if (user) promptOnNextUserConnection = false;
  currentUser = user;
  currentUserPremium = false;
  cloudSyncPaused = Boolean(user);
  renderAccount(user);
  if (!user) {
    remoteFingerprint = '';
    sessionStorage.removeItem('collector-restored-spreadsheet-id');
    sessionStorage.removeItem('collector-restored-spreadsheet-url');
    announceGoogleAuth(null);
    nativeRemoveItem.call(localStorage, 'minifig-firebase-user-id');
    const guestChanged = localStorage.getItem('minifig-spreadsheet-id') !== GUEST_SPREADSHEET_ID || localStorage.getItem('minifig-collections') !== JSON.stringify(GUEST_COLLECTIONS);
    nativeSetItem.call(localStorage, 'minifig-spreadsheet-id', GUEST_SPREADSHEET_ID);
    nativeSetItem.call(localStorage, 'minifig-spreadsheet-url', GUEST_SPREADSHEET_URL);
    nativeSetItem.call(localStorage, 'minifig-collections', JSON.stringify(GUEST_COLLECTIONS));
    if (!GUEST_COLLECTIONS.includes(localStorage.getItem('minifig-collection'))) nativeSetItem.call(localStorage, 'minifig-collection', GUEST_COLLECTIONS[0]);
    if (guestChanged) {
      const settingsDialog = document.querySelector('#settingsDialog');
      if (deferGuestReloadUntilSettingsClose && settingsDialog?.open) {
        const spreadsheetInput = document.querySelector('#spreadsheetUrl');
        const collectionInput = document.querySelector('#collectionNames');
        if (spreadsheetInput) spreadsheetInput.value = GUEST_SPREADSHEET_URL;
        if (collectionInput) collectionInput.value = GUEST_COLLECTIONS.join('\n');
        status('Signed out. Demo mode will load after closing Settings.');
        settingsDialog.addEventListener('close', () => location.reload(), { once: true });
      } else {
        location.reload();
      }
    }
    deferGuestReloadUntilSettingsClose = false;
    return;
  }

  currentUserPremium = PREMIUM_ENTITLEMENTS_ENABLED ? await hasPremiumAccess(user) : true;
  if (revision !== authStateRevision) return;
  renderAccount(user, currentUserPremium);
  if (!currentUserPremium) {
    announceGoogleAuth(user, '', false);
    pendingGoogleAccessToken = '';
    nativeRemoveItem.call(localStorage, 'minifig-firebase-user-id');
    sessionStorage.removeItem('collector-restored-spreadsheet-id');
    sessionStorage.removeItem('collector-restored-spreadsheet-url');
    const guestChanged = localStorage.getItem('minifig-spreadsheet-id') !== GUEST_SPREADSHEET_ID || localStorage.getItem('minifig-collections') !== JSON.stringify(GUEST_COLLECTIONS);
    nativeSetItem.call(localStorage, 'minifig-spreadsheet-id', GUEST_SPREADSHEET_ID);
    nativeSetItem.call(localStorage, 'minifig-spreadsheet-url', GUEST_SPREADSHEET_URL);
    nativeSetItem.call(localStorage, 'minifig-collections', JSON.stringify(GUEST_COLLECTIONS));
    nativeSetItem.call(localStorage, 'minifig-collection', GUEST_COLLECTIONS[0]);
    status(`Signed in as ${user.email || 'Google user'}. A premium license is required for full access.`, true);
    window.dispatchEvent(new CustomEvent('collector-premium-required', { detail: { uid: user.uid, email: user.email || '' } }));
    if (guestChanged) location.reload();
    return;
  }

  nativeSetItem.call(localStorage, 'minifig-firebase-user-id', user.uid);
  const loginAccessToken = pendingGoogleAccessToken || cachedGoogleAccessToken();
  announceGoogleAuth(user, loginAccessToken, true);
  pendingGoogleAccessToken = '';
  sessionStorage.removeItem('collector-restored-spreadsheet-id');
  sessionStorage.removeItem('collector-restored-spreadsheet-url');
  status(`Signed in as ${user.email || 'Google user'}. Checking Google Drive for your collection spreadsheet…`);
  const discoveredSpreadsheet = await findCollectorSpreadsheet(loginAccessToken);
  if (revision !== authStateRevision) return;
  const spreadsheetBeforeDiscovery = spreadsheetIdFromValue(localStorage.getItem('minifig-spreadsheet-id') || '');
  const discoveredSpreadsheetChanged = Boolean(discoveredSpreadsheet?.id && discoveredSpreadsheet.id !== spreadsheetBeforeDiscovery);
  if (discoveredSpreadsheet?.id) {
    const spreadsheetUrl = discoveredSpreadsheet.webViewLink || `https://docs.google.com/spreadsheets/d/${discoveredSpreadsheet.id}/edit`;
    nativeSetItem.call(localStorage, 'minifig-spreadsheet-id', discoveredSpreadsheet.id);
    nativeSetItem.call(localStorage, 'minifig-spreadsheet-url', spreadsheetUrl);
    if (discoveredSpreadsheetChanged) {
      sessionStorage.setItem('collector-restored-spreadsheet-id', discoveredSpreadsheet.id);
      sessionStorage.setItem('collector-restored-spreadsheet-url', spreadsheetUrl);
    }
  }

  const reference = doc(db, 'users', user.uid);
  const snapshot = await getDoc(reference);
  if (revision !== authStateRevision) return;
  const remoteData = snapshot.data() || {};
  const localSpreadsheetId = spreadsheetIdFromValue(localStorage.getItem('minifig-spreadsheet-id') || '');
  if (!shouldOfferCloudDownload && localSpreadsheetId && localSpreadsheetId !== GUEST_SPREADSHEET_ID && discoveredSpreadsheet !== null) {
    status(`Signed in as ${user.email || 'Google user'}.${discoveredSpreadsheet ? ' Your existing collection spreadsheet was found.' : ''}`);
    if (discoveredSpreadsheetChanged) location.reload();
    return;
  }

  const remoteSettings = settingsFromRemoteData(remoteData);
  const remoteSpreadsheetId = remoteSettings?.['minifig-spreadsheet-id'] || '';
  if (!remoteSettings || !remoteSpreadsheetId || remoteSpreadsheetId === GUEST_SPREADSHEET_ID) {
    if (localSpreadsheetId && localSpreadsheetId !== GUEST_SPREADSHEET_ID && discoveredSpreadsheet !== null) {
      status(`Signed in as ${user.email || 'Google user'}. Your current personal spreadsheet was kept.`);
      if (discoveredSpreadsheetChanged) location.reload();
      return;
    }
    nativeSetItem.call(localStorage, 'minifig-spreadsheet-id', GUEST_SPREADSHEET_ID);
    nativeSetItem.call(localStorage, 'minifig-spreadsheet-url', GUEST_SPREADSHEET_URL);
    const spreadsheetWasChecked = discoveredSpreadsheet === null;
    status(`Signed in as ${user.email || 'Google user'}. ${spreadsheetWasChecked ? 'No collection spreadsheet was found. Create your first collection to get started.' : 'No personal spreadsheet configuration is saved yet.'}`);
    window.dispatchEvent(new CustomEvent('collector-onboarding-needed', { detail: { uid: user.uid, email: user.email || '', reason: spreadsheetWasChecked ? 'spreadsheet-not-found' : 'configuration-not-found' } }));
    return;
  }
  remoteFingerprint = fingerprint(remoteSettings);
  if (!shouldOfferCloudDownload) {
    status(`Signed in as ${user.email || 'Google user'}. A saved configuration is available from Settings.`);
    return;
  }
  const download = await confirmCloudSettingsDownload(user, remoteSettings);
  if (revision !== authStateRevision) return;
  if (!download) {
    status(`Signed in as ${user.email || 'Google user'}. The current configuration was kept.`);
    if (discoveredSpreadsheetChanged) location.reload();
    return;
  }
  stageRestoredSpreadsheet(remoteSettings);
  applySettings(remoteSettings);
  location.reload();
}

window.addEventListener('collector-onboarding-complete', () => {
  saveNow(true).then(() => status('Your collection spreadsheet is ready and its configuration was saved.')).catch(error => status(`Spreadsheet created, but configuration sync failed: ${error.message}`, true));
});

installSettingsUi();
setPersistence(auth, browserLocalPersistence)
  .then(async () => {
    if (sessionStorage.getItem(REDIRECT_SIGN_IN_KEY) === '1') promptOnNextUserConnection = true;
    try {
      const result = await getRedirectResult(auth);
      if (result) {
        pendingGoogleAccessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken || '';
        if (currentUser?.uid === result.user.uid && currentUserPremium) {
          announceGoogleAuth(result.user, pendingGoogleAccessToken, true);
        }
      }
      sessionStorage.removeItem(REDIRECT_SIGN_IN_KEY);
    } catch (error) {
      promptOnNextUserConnection = false;
      sessionStorage.removeItem(REDIRECT_SIGN_IN_KEY);
      status(`Sign-in failed: ${error.message}`, true);
    }
    onAuthStateChanged(auth, user => connectUser(user).catch(error => status(`Sync failed: ${error.message}`, true)));
  })
  .catch(error => status(`Sign-in persistence failed: ${error.message}`, true));
