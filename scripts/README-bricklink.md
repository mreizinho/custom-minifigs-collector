# BrickLink lookup

The Add New dialog accepts a Star Wars minifigure BL code, fetches its catalogue
name and image, and shows its six-month average sold price for new items in EUR.
The suggested Character is the portion of the name before ` - ` and is editable.
No sales leaves the estimated value blank. The existing sequential figure ID is
independent of the BL code. Duplicate BL codes within a collection are rejected.

## Server configuration

The existing reminder Worker serves authenticated POST `/bricklink` requests.
Set these Cloudflare Worker secrets before deploying:

- `BRICKLINK_CONSUMER_KEY`
- `BRICKLINK_CONSUMER_SECRET`
- `BRICKLINK_TOKEN`
- `BRICKLINK_TOKEN_SECRET`

The owner's Firebase Authentication UID is configured in `wrangler.toml` as
`BRICKLINK_ALLOWED_UID`; it is an identifier, not a secret.

Use `node --env-file=.env.bricklink scripts/configure-bricklink-secrets.mjs`,
Wrangler's secret input prompts, or the Cloudflare dashboard. Never put
credentials in source, browser storage, command arguments, or frontend assets.
Without the configured allowed UID, the route refuses every lookup. Only the
owner may use the shared BrickLink credentials. Results are cached for 24 hours
per Cloudflare location. OAuth request signing uses Node compatibility mode.

Deploy the Worker with `npx wrangler deploy`, then publish the static site through
its existing Git/Cloudflare Pages flow. Keep the existing OneSignal secret.

## Spreadsheet writes

On adding a fetched figure, append missing metadata headers (BrickLink Code,
BL Price Basis, BL Price Updated, Photo URL), then save those fields with the new
figure row. Existing values and row order are preserved. Photo URL links directly
to the BrickLink catalogue image; a selected personal photo takes precedence.
The price metadata describes the fetched reference price; the estimated value
remains editable and may differ. No separate collection is automatically created.

## Verification

`node --test scripts/bricklink-lookup.test.mjs scripts/add-figure.test.mjs`

Local live check (ignored credential file):
`node --env-file=.env.bricklink scripts/bricklink-lookup.mjs sw0001a`

After deployment, sign in as the owner, fetch `sw0001a` in Add New, review the
name/photo/price, and save only to the intended collection. Check the new sheet
row, duplicate-code rejection, invalid-code feedback, and manual-add flow.
