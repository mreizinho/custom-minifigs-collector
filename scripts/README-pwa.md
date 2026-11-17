# Home-screen installation

`manifest.webmanifest` provides the app name, standalone launch mode, stable app
identity, and home-screen icons. Main and privacy pages link to the same manifest.
Android browsers can offer Install app / Add to Home screen. On iPhone, use
Safari's Share → Add to Home Screen.

The existing OneSignal service worker remains in place. Collection syncing and
Google sign-in use the normal online website; this change adds no offline cache.

`pwa-theme.js` updates page-level theme-color, color-scheme, and the root canvas
from the site's saved/selected theme. Android/Chrome may apply additional rules
to native navigation bars, so their final appearance remains platform-dependent.

The manifest uses a dark launch/background fallback (#181917). This is a
workaround trial for installed Android apps retaining the manifest colour on
their navigation bar despite page-level theme changes. The page still selects
its own light/dark colours normally. Installed apps may need a manifest update
or reinstallation to pick up this fallback; actual Android behaviour needs
device verification.

Icons are rasterized from the existing vector head mark with no third-party
image service. To regenerate them, run `node scripts/build-app-icons.mjs`.

Validate production artifacts with:

    node scripts/build-static.mjs
    node --test scripts/pwa-manifest.test.mjs scripts/demo-assets.test.mjs
