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
  onSnapshot,
  runTransaction,
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
const isCloudSettingKey = key => String(key).startsWith('minifig-') && !String(key).startsWith('minifig-theme') && !String(key).startsWith('minifig-collection-order-') && !ignoredKeys.has(String(key));
const nativeSetItem = Storage.prototype.setItem;
const nativeRemoveItem = Storage.prototype.removeItem;
let currentUser = null;
let currentUserPremium = false;
let bricklinkPremiumVerified = false;
let remoteFingerprint = '';
let saveTimer = 0;
let applyingRemote = false;
let settingsBaseline = null;
let pendingGoogleAccessToken = '';
let authActionPending = false;
let deferGuestReloadUntilSettingsClose = false;
let explicitSignOutPending = false;
let cloudSyncPaused = false;
let authStateRevision = 0;
let promptOnNextUserConnection = false;
let pendingCloudSettings = null;
// Premium licensing has not launched yet. Keep the entitlement implementation
// available, but grant the current product to every authenticated Google user.
const PREMIUM_ENTITLEMENTS_ENABLED = false;
const REDIRECT_SIGN_IN_KEY = 'collector-google-redirect-pending';
// Popup authentication preserves the app origin and session reliably on mobile.
// Keep redirect only as a fallback for browsers that explicitly block popups.
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
  window.collectorGetIdToken = async () => {
    if (!auth.currentUser) throw new Error('Sign in with Google first.');
    return auth.currentUser.getIdToken();
  };
  window.collectorFirebaseAuthenticatedUser = user?.uid || '';
  window.collectorFirebaseUser = user && premium ? user.uid : '';
  window.collectorPremiumUser = Boolean(user && premium);
  window.collectorBricklinkPremium = Boolean(user && bricklinkPremiumVerified);
  window.dispatchEvent(new CustomEvent('collector-bricklink-access', { detail: { premium: window.collectorBricklinkPremium } }));
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
    if (force) throw new Error(authenticatedUser ? 'A premium licence is required before uploading.' : 'Google sign-in is not active. Sign in again before uploading.');
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
  status(user ? `Signed in as ${user.email || 'Google user'}.` : 'Demo mode. Sign in with Google to find or create your personal collection spreadsheet.');
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
  const spreadsheetSection = pickerButton?.closest('section');
  if (pickerButton) {
    pickerButton.setAttribute('aria-label', 'Open Spreadsheet');
    pickerButton.title = 'Open Spreadsheet';
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
    <div class="google-settings-heading"><h3>Google Account and Spreadsheet</h3></div>
    <input id="googleClientId" type="hidden">
    <button type="button" id="connectGoogle" hidden></button>
    <button type="button" id="saveGoogleClient" hidden></button>
    <button type="button" id="saveOnline" hidden></button>
    <button type="button" id="loadOnline" hidden></button>
    <button type="button" id="disconnectGoogle" hidden></button>
    <p>Use your Google Account to backup, restore and sync your configuration across multiple devices. Choose Save to store this device’s configuration, or Load to restore a saved configuration.</p>
    <div class="google-settings-actions settings-account-actions">
      <button type="button" id="firebaseAuth"><span class="material-symbols-rounded">login</span>Sign in</button>
      <button type="button" id="connectGoogleDrive" hidden>Connect Google Drive</button>
      <button type="button" id="firebaseUpload" data-firebase-required><span class="material-symbols-rounded">save</span>Save</button>
      <button type="button" id="firebaseDownload" data-firebase-required><span class="material-symbols-rounded">folder_open</span>Load</button>
    </div>
    <p class="settings-save-warning"><span class="material-symbols-rounded" aria-hidden="true">warning</span><span><strong>Important:</strong> After adding or deleting custom tags, choose Save to back up those changes to your Google Account.</span></p>
    <p id="firebaseStatus" class="settings-status" role="status" aria-live="polite"></p>`;
  if (pickerButton) section.querySelector('.google-settings-heading')?.append(pickerButton);
  const spreadsheetInput = spreadsheetSection?.querySelector('#spreadsheetUrl');
  if (spreadsheetInput) section.append(spreadsheetInput);
  if (saveSpreadsheet) section.append(saveSpreadsheet);
  spreadsheetSection?.remove();
  let settingsFooter = document.querySelector('.settings-footer');
  if (!settingsFooter) {
    settingsFooter = document.createElement('div');
    settingsFooter.className = 'settings-footer';
    settingsFooter.innerHTML = '<button type="button" id="applySettings" disabled><span class="material-symbols-rounded">check</span>Apply</button>';
    document.querySelector('.settings-copy').append(settingsFooter);
  }
  const driveButton = document.querySelector('#connectGoogleDrive');
  window.addEventListener('collector-google-access-required', () => { driveButton.hidden = !auth.currentUser; });
  window.addEventListener('collector-google-access-ready', () => { driveButton.hidden = true; });
  window.addEventListener('collector-google-auth', event => {
    if (!event.detail?.uid) { driveButton.hidden = true; return; }
    // Offer the one-time connection even while an older browser token still works.
    // This checks only the backend; it cannot open a Google window.
    window.collectorGoogleAccess?.refresh().catch(() => {});
  });
  driveButton.onclick = async () => {
    try { await window.collectorReconnectGoogleAccess(); status('Google Drive connected. Future launches will reconnect in the background.'); }
    catch (error) { status(error.message, true); }
  };
  document.querySelector('#firebaseAuth').addEventListener('click', async () => {
    if (authActionPending) return;
    authActionPending = true;
    document.querySelector('#firebaseAuth').disabled = true;
    try {
      if (auth.currentUser) {
        deferGuestReloadUntilSettingsClose = Boolean(document.querySelector('#settingsDialog')?.open);
        explicitSignOutPending = true;
        await signOut(auth);
      } else {
        const splashFinished = window.collectorSplash?.beforeInteraction();
        if (splashFinished) await splashFinished;
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
      explicitSignOutPending = false;
      if (error.code === 'auth/popup-blocked' && !useRedirectSignIn) {
        sessionStorage.setItem(REDIRECT_SIGN_IN_KEY, '1');
        await signInWithRedirect(auth, provider);
        return;
      }
      promptOnNextUserConnection = false;
      const message = error.code === 'auth/cancelled-popup-request'
          ? 'Google sign-in is already opening. Please wait for it to finish.'
        : error.code === 'auth/unauthorized-domain'
          ? 'This website is not listed in Firebase Authentication authorised domains.'
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
  const rememberedUserId = localStorage.getItem('minifig-google-user-id') || localStorage.getItem('minifig-firebase-user-id') || '';
  if (!user && rememberedUserId && !explicitSignOutPending) {
    currentUser = null;
    currentUserPremium = true;
    cloudSyncPaused = true;
    renderAccount(null);
    announceGoogleAuth({ uid: rememberedUserId }, '', true);
    status('Your collection remains available. Google access will reconnect when an action needs it.');
    return;
  }
  const shouldOfferCloudDownload = Boolean(user && promptOnNextUserConnection);
  if (user) promptOnNextUserConnection = false;
  currentUser = user;
  currentUserPremium = false;
  bricklinkPremiumVerified = false;
  window.collectorBricklinkPremium = false;
  window.dispatchEvent(new CustomEvent('collector-bricklink-access', { detail: { premium: false } }));
  cloudSyncPaused = Boolean(user);
  renderAccount(user);
  if (!user) {
    explicitSignOutPending = false;
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
  try { bricklinkPremiumVerified = PREMIUM_ENTITLEMENTS_ENABLED ? currentUserPremium : await hasPremiumAccess(user); }
  catch (error) { bricklinkPremiumVerified = false; console.warn('BrickLink premium access could not be verified.', error); }
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
    status(`Signed in as ${user.email || 'Google user'}. A premium licence is required for full access.`, true);
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
    if (localSpreadsheetId && localSpreadsheetId !== GUEST_SPREADSHEET_ID) {
      status(`Signed in as ${user.email || 'Google user'}. Your saved collection is active.`);
      return;
    }
    stageRestoredSpreadsheet(remoteSettings);
    applySettings(remoteSettings);
    status(`Signed in as ${user.email || 'Google user'}. Restoring your saved collection…`);
    location.reload();
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

// Brickset defaults sync independently of manual settings backup and restore.
const bricksetTagOwner = 'rh8WrITlLTXrsDj5mbJHzA1D4Bk2';
const bricksetTagsKey = `collector-brickset-default-tags-v1-${bricksetTagOwner}`;
const pendingBricksetTagsKey = `${bricksetTagsKey}-pending`;
let unsubscribeBricksetTags, writingBricksetTags = false;
const validBricksetTags = tags => Array.isArray(tags) && tags.every(tag => typeof tag === 'string' && tag)
  ? [...new Set(tags)] : null;
function readPendingBricksetTags() {
  try { return validBricksetTags(JSON.parse(localStorage.getItem(pendingBricksetTagsKey))); }
  catch { return null; }
}
async function syncPendingBricksetTags() {
  if (writingBricksetTags || auth.currentUser?.uid !== bricksetTagOwner) return;
  const tags = readPendingBricksetTags();
  if (!tags) return;
  writingBricksetTags = true;
  try {
    await setDoc(doc(db, 'users', bricksetTagOwner), { bricksetDefaultTags: tags }, { merge: true });
    if (JSON.stringify(readPendingBricksetTags()) === JSON.stringify(tags)) {
      nativeRemoveItem.call(localStorage, pendingBricksetTagsKey);
    }
  } catch (error) {
    console.warn('Brickset default tags could not sync yet.', error);
    return;
  } finally {
    writingBricksetTags = false;
  }
  if (readPendingBricksetTags()) void syncPendingBricksetTags();
}
window.addEventListener('collector-brickset-default-tags-changed', syncPendingBricksetTags);
window.addEventListener('online', syncPendingBricksetTags);
onAuthStateChanged(auth, user => {
  unsubscribeBricksetTags?.();
  unsubscribeBricksetTags = null;
  if (user?.uid !== bricksetTagOwner) return;
  const settings = doc(db, 'users', user.uid);
  let migrating = false;
  unsubscribeBricksetTags = onSnapshot(settings, { includeMetadataChanges: true }, snapshot => {
    if (auth.currentUser?.uid !== user.uid || snapshot.metadata.hasPendingWrites) return;
    if (readPendingBricksetTags()) { void syncPendingBricksetTags(); return; }
    const remote = validBricksetTags(snapshot.data()?.bricksetDefaultTags);
    if (remote) {
      try { nativeSetItem.call(localStorage, bricksetTagsKey, JSON.stringify(remote)); }
      catch (error) { console.warn('Could not cache Brickset default tags.', error); }
      window.dispatchEvent(new CustomEvent('collector-brickset-default-tags-synced', { detail: remote }));
      return;
    }
    if (migrating || snapshot.metadata.fromCache) return;
    let local;
    try {
      const saved = localStorage.getItem(bricksetTagsKey);
      const legacy = localStorage.getItem(`collector-brickset-default-tag-v1-${user.uid}`);
      local = validBricksetTags(saved === null ? (legacy ? [legacy] : []) : JSON.parse(saved));
    } catch { return; }
    if (!local?.length) return;
    migrating = true;
    runTransaction(db, async transaction => {
      const latest = await transaction.get(settings);
      if (auth.currentUser?.uid !== user.uid || readPendingBricksetTags() ||
          Object.hasOwn(latest.data() || {}, 'bricksetDefaultTags')) return;
      transaction.set(settings, { bricksetDefaultTags: local }, { merge: true });
    }).catch(error => console.warn('Could not migrate Brickset default tags.', error))
      .finally(() => { migrating = false; });
  }, error => console.warn('Brickset default tags subscription failed.', error));
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

// Collection menu order sync is independent of manual settings upload/download.
let unsubscribeCollectionOrder=null;
const validMenuOrder=value=>Array.isArray(value)&&value.every(name=>typeof name==='string')? [...new Set(value)]:null;
window.addEventListener('collector-collection-order-changed',async event=>{
  const user=auth.currentUser,{spreadsheetId,order}=event.detail||{};
  if(!user||typeof spreadsheetId!=='string'||!validMenuOrder(order))return;
  try{await setDoc(doc(db,'users',user.uid),{collectionMenuOrders:{[spreadsheetId]:validMenuOrder(order)}},{merge:true})}
  catch(error){console.warn('Collection order sync failed.',error);window.dispatchEvent(new CustomEvent('collector-collection-order-error'))}
});
onAuthStateChanged(auth,user=>{
  unsubscribeCollectionOrder?.();unsubscribeCollectionOrder=null;
  if(!user)return;
  unsubscribeCollectionOrder=onSnapshot(doc(db,'users',user.uid),snapshot=>{
    if(auth.currentUser?.uid!==user.uid)return;
    const orders=snapshot.data()?.collectionMenuOrders||{};
    for(const [spreadsheetId,value] of Object.entries(orders)){
      const order=validMenuOrder(value);if(!order)continue;
      nativeSetItem.call(localStorage,'minifig-collection-order-'+spreadsheetId,JSON.stringify(order));
    }
    window.dispatchEvent(new CustomEvent('collector-collection-order-updated'));
    // Migrate the desktop's existing saved order once if it has no cloud copy.
    const spreadsheetId=localStorage.getItem('minifig-spreadsheet-id');
    if(!spreadsheetId||Object.hasOwn(orders,spreadsheetId))return;
    let local;try{local=validMenuOrder(JSON.parse(localStorage.getItem('minifig-collection-order-'+spreadsheetId)||'null'))}catch{return}
    if(local)setDoc(doc(db,'users',user.uid),{collectionMenuOrders:{[spreadsheetId]:local}},{merge:true}).catch(error=>console.warn('Collection order migration failed.',error));
  },error=>console.warn('Collection order subscription failed.',error));
});
