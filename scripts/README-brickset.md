# Brickset collection

The owner's collection menu includes `Brickset`, an external read-only source.
It reads every owned minifigure, uses the first category component as a theme
tag, and splits Brickset notes on commas, semicolons, pipes, or newlines into
additional tags. Stable IDs are `Brickset::<BL reference>`; quantities are
shown in details. Images load directly from BrickLink. Brickset does not provide
minifigure prices, so `/brickset/prices` loads the BrickLink six-month average
new-condition sold price in EUR, falling back to used-condition sales when no new
sales price is available. Used fallback valuations are identified in figure details.
Batches contain at most eight owned references,
with two upstream requests at a time and 24-hour server/device caching. Card and
detail prices are per figure; the owned total includes duplicate copies. Missing
prices remain unavailable, and incomplete totals are labelled as partial estimates.
Refreshing resumes missing or stale prices without discarding successful results.
Legacy cached no-sales results are retried with the used fallback. Figure counts
use dot-separated thousands consistently across statistics and collection summaries.

The Worker POST `/brickset` route validates the Firebase ID token and restricts
access to `BRICKSET_ALLOWED_UID`. It uses only Brickset read methods, caches
normalized results for 15 minutes, and never sends upstream credentials to the
browser. Explicit Refresh bypasses the Worker cache. An account-scoped device
cache supports viewing during upstream outages and is excluded from settings
sync. Custom tags continue to use the site's existing tag storage.

Configure secrets from the ignored `.env.brickset` file:

    node --env-file=.env.brickset scripts/configure-brickset-secrets.mjs
    npx wrangler deploy

`BRICKSET_API_KEY` and `BRICKSET_USER_HASH` are secrets. Never include the
configuration file, private snapshots, or credentials in static build output.
The previous CSV-imported Google Sheet collection remains untouched.

Validation:

    node --test scripts/brickset-collection.test.mjs scripts/brickset-client.test.mjs scripts/brickset-prices.test.mjs
    node scripts/build-static.mjs
