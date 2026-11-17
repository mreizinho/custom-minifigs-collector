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

Installed Android apps opt into viewport-fit=cover. On Chrome builds supporting
standalone edge-to-edge, the page canvas can paint behind the navigation bar.
`pwa-theme.css` protects the system-bar safe areas and spaces the page/header
and full-height mobile forms. This is a device-verification trial: Chrome's
standalone edge-to-edge rollout varies, and browser versions may ignore it.
Normal browser tabs and non-Android platforms retain their existing viewport.
Following comparison with BrickGEST, both the initial HTML theme-color and
manifest theme_color now use #181917. The manifest background remains light
(launch background is separate from system-bar theme colour). The viewport
declares cover in HTML so it is available before JavaScript; the early script
removes it outside installed Android apps. Runtime light/dark switching remains.
This trials BrickGEST's matching startup declarations; it does not establish
that dynamic navigation-bar changes work on physical Android hardware.
The manifest response requires HTTP revalidation on each request rather than
allowing an hour of cached metadata. This does not bypass Chrome's own WebAPK
update schedule or guarantee an installed-package update.

The browser favicon, Apple touch icon, and installed PWA icons all derive from
`assets/splash/head2.svg`. `icons/head2.svg` preserves its original paths/styles
with square framing and a light background; matching PNGs cover 32, 180, 192,
and 512 pixels. The same framing leaves room for Android icon masks. Old icon
files remain available for older installations, but current metadata references
only the new head2 family. Theme changes no longer substitute another favicon.

To regenerate icons, install the pinned renderer into the ignored temporary
tools folder, then run the generator. No runtime/site dependency is added:

    npm install --prefix tmp/icon-tools --no-save --package-lock=false --ignore-scripts @resvg/resvg-js@2.6.2
    node scripts/build-app-icons.mjs

## Supplied animated splash

Installed standalone/fullscreen PWAs show `assets/splash/lego-splash.html` in an
isolated iframe. Its SVG and style block are verbatim from the supplied
`lego-head-morph-synced.zip`; only the demo controls/hint/controller were replaced.
The original head1/head2/head3 SVG files are retained alongside the integrated
HTML. The white background, synchronized expressions, and 3.4-second morph
animation are unchanged. The frame signals completion on the supplied
head-motion animationend (immediately with reduced motion). `pwa-splash.js`
then waits for the initial demo/sheet/Brickset
result or an actionable error/onboarding state before fading for 300ms.
Google Sheets authorization and Firebase sign-in use `beforeInteraction()` to
wait for the animation and fade to finish before opening a Google popup. An
authorization requirement counts as an actionable ready state, avoiding a
dependency cycle between splash dismissal and token acquisition. Once the
splash is gone, ordinary sign-in clicks remain synchronous up to popup launch.
An 8-second safety deadline releases the UI even if startup or the frame fails.
It never waits for all 2,188 photos or background prices. A saved Brickset
snapshot counts as ready. Returning from another app does not replay it.
Ordinary browser tabs load no splash frame. No dependency or service-worker
changes are needed. This page intro follows Android's native static splash.
For explicit browser QA only, `/?splash=preview` enables the same startup intro
without requiring PWA installation; normal browser visits remain unchanged.

Validate production artifacts with:

    node scripts/build-static.mjs
    node --test scripts/pwa-manifest.test.mjs scripts/pwa-theme.test.mjs scripts/pwa-splash.test.mjs scripts/demo-assets.test.mjs
