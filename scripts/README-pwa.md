# Home-screen installation

`manifest-mobile.webmanifest` and `manifest-desktop.webmanifest` provide two
separate installations with platform-specific names and icons:

- `/mobile/`: Collector; identity, start URL, and scope `/mobile/`.
- `/desktop/`: Custom Minifigs Collector; identity, start URL, and scope `/desktop/`.

The build creates both entry pages from the same app HTML, using `<base href="/">`
for shared assets. `pwa-install.js` selects a manifest by explicit route first,
otherwise by device type (never by window width). Root and privacy pages use the
same selector. The legacy `/manifest.webmanifest` remains at its original URL
and identity for existing installations, but new install pages use the distinct,
non-overlapping scopes. Remove the old root-scoped installation before installing
the appropriate new version, without clearing the origin's saved site data.
The two installations intentionally share storage, authentication, permissions,
and the existing OneSignal worker on this origin; they are not isolated accounts.
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

Desktop large installed icons use the supplied Asset 2.png, stored unchanged as
`assets/icons/desktop-head-source.png`. The generator fits its complete artwork
into 192px and 512px squares, preserving transparency, colors and proportions.
The source is build-only and is not shipped in the static site. There are
16x16 and 32x32 PNGs of the browser-tab outline offered separately in the desktop manifest.
Chrome's app-window loader requests `kWebAppIconSmall` (32px) as its minimum;
the 16px-only trial was too small and therefore selected a larger yellow icon.
This is a Windows small-icon selection trial: Chrome/Windows decide which size
to use for each surface and display scale. Mobile metadata and icons are unchanged.
Desktop browser tabs restore
the original `lego-head.svg?v=3#favicon-outline` after the head is parsed;
mobile tab favicons are unchanged. Mobile installed icons use the
supplied f1.svg artwork, including its blank opening expression. Its ordinary
icons use a 900-unit square viewport; the separate maskable icon uses an 800-unit
square viewport and a fully opaque white background. Android supplies the outer
adaptive shape. All non-white artwork fits within the central 40%-radius safe
circle (artwork is scaled to 85% around the canvas center; safe radius 204.8px).
The mobile Apple touch icon also uses f1. The hidden, non-rendering external
image reference and editor metadata were removed from the source SVG; paths and
styles are preserved. Existing icon assets remain available for old installs.

To regenerate icons, install the pinned renderer into the ignored temporary
tools folder, then run the generator. No runtime/site dependency is added:

    npm install --prefix tmp/icon-tools --no-save --package-lock=false --ignore-scripts @resvg/resvg-js@2.6.2
    node scripts/build-app-icons.mjs

## Supplied animated splash

Installed standalone/fullscreen PWAs show `assets/splash/lego-splash.html` in an
isolated iframe. It uses 9 lego-fuse-top-right-synced.zip: the supplied six-frame
sequence runs for 6.2 seconds, including bounces, pause, fuse, flashes and zoom.
The inline SVG, reusable definitions, colors and animation CSS are unchanged.
The supplied measured-path fuse script is retained so spark and stroke share
one progress value; only demo Replay controls/wiring are removed. A separate
completion bridge preserves the startup and Google sign-in handoff.
Desktop retains supplied responsive sizing. Mobile aligns the original viewport
to a 240 CSS-pixel maskable launch canvas using the icon's 800-unit framing and 85% artwork scale,
then enlarges the mobile animation by 10% for the native-icon handoff (278.28405px stage width);
native Chrome/Android placement remains device-controlled and needs phone QA.
Reduced motion shows frame6 immediately. The root bounce animationend signals
completion exactly once. pwa-splash.js
then waits for the initial demo/sheet/Brickset
result or an actionable error/onboarding state before fading for 300ms.
Google Sheets authorization and Firebase sign-in use `beforeInteraction()` to
wait for the animation and fade to finish before opening a Google popup. An
authorization requirement counts as an actionable ready state, avoiding a
dependency cycle between splash dismissal and token acquisition. Once the
splash is gone, ordinary sign-in clicks remain synchronous up to popup launch.
A 12-second safety deadline releases the UI even if startup or the frame fails.
It never waits for all 2,188 photos or background prices. A saved Brickset
snapshot counts as ready. Returning from another app does not replay it.
Ordinary browser tabs load no splash frame. No dependency or service-worker
changes are needed. This page intro follows Android's native static splash.
For explicit browser QA only, `/mobile/?splash=preview` or
`/desktop/?splash=preview` enables the same startup intro
without requiring PWA installation; normal browser visits remain unchanged.

Validate production artifacts with:

    node scripts/build-static.mjs
    node --test scripts/pwa-install.test.mjs scripts/pwa-manifest.test.mjs scripts/pwa-theme.test.mjs scripts/pwa-splash.test.mjs scripts/demo-assets.test.mjs
