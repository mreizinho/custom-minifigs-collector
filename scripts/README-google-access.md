# Background Google Drive authorization

Firebase keeps the website login persistent. Google Drive authorization is now
separate: startup uses an authenticated Worker endpoint, never an OAuth popup.
An explicit **Connect Google Drive** action requests a one-time authorization
code. The Worker exchanges it, verifies Google's subject matches the verified
Firebase Google identity, and stores tokens encrypted with AES-GCM in Workers KV.
The encryption also binds the stored data to the Firebase UID.

Access tokens expire normally and are renewed by the Worker without a window.
Only a missing/revoked connection asks the user to connect again. Temporary
network errors preserve the connection and do not trigger consent. Refresh
tokens and the OAuth client secret are never returned to the browser, stored in
Firestore, or included in settings backups. Responses are private/no-store.

## One-time deployment setup

1. In Google Cloud's **Google Auth Platform > Clients**, open the web client
   `725550496124-u8ofih3mkl5mcq1r7vp270r6ulk7algb.apps.googleusercontent.com`.
2. Put that client's secret in the ignored `.env.google` file as
   `GOOGLE_OAUTH_CLIENT_SECRET=...`. Do not send it in chat or commit it.
3. Run `node scripts/configure-google-access.mjs`. This creates the KV namespace,
   configures the binding, generates/preserves an encryption key, and uploads the
   two secrets using stdin. Keep the ignored file securely; changing the key
   invalidates existing encrypted connections.
4. Deploy the Worker with `npx wrangler deploy` **before publishing the client**.
5. Existing users click **Connect Google Drive** once. After that, close/reopen
   and expired-token startup should load privately without opening Google.

The OAuth consent screen must be in Production for durable refresh grants.
Google may expire testing-mode grants after seven days or revoke access for
other account/security reasons; the app cannot bypass that renewed consent.
The existing `drive.file` scope is preserved; no broader Drive permission added.

## Verification

`node --test scripts/google-access.test.mjs scripts/pwa-splash.test.mjs`

After deployment, verify first-time consent, cold PWA launch, expired access
token renewal, sign-out/account switch, and manually revoked Google access.
Code flow reference: https://developers.google.com/identity/oauth2/web/guides/use-code-model
