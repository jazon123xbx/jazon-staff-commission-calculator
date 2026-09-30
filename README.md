# Jazon Staff Commission Calculator

GAME_GIFT Sales & Staff Earnings — a lightweight internal calculator for Jazon Roblox
GAME_GIFT sales and staff commission payouts.

Plain HTML + CSS + vanilla JavaScript. No build step, no npm, no server, no database,
no authentication, no CDN, no network calls.

## How to use

1. Open `index.html` in any modern browser (double-click it).
2. Enter or select the **Staff Name**.
3. Choose **Catalog Sale** (fixed products) or **Manual Gift Sale** (your own Robux cost).
4. Fill in the fields and press **Add Sale**.
5. Watch the summary cards, **Staff Earnings** and **Sales History** update immediately.
6. Press **Export CSV** whenever you need a record of staff sales / commissions.

Sales are saved in your browser's `localStorage`, so they survive a page refresh.
Use **Clear All Sales** to wipe everything (it asks for confirmation first).
Use the **Staff Filter** in the top bar to show one staff member only — dashboard
totals, earnings, history and the CSV export all follow that filter.

## Locked rates

| Sale type | Base | Default sell | Staff commission |
| --- | --- | --- | --- |
| GAME_GIFT (catalog + manual) | ₱40 per 100 Robux | ₱45 per 100 Robux | ₱5 per 100 Robux |
| VIA_PLUS (manual only) | ₱70 per 100 Robux | ₱75 per 100 Robux | ₱5 per 100 Robux |

```
GAME_GIFT:  base = robux × 40 / 100   sell = robux × 45 / 100   commission = robux × 5 / 100
VIA_PLUS:   base = robux × 70 / 100   sell = robux × 75 / 100   commission = robux × 5 / 100
```

Commission is always calculated **independently from Robux**. It is never derived as
`selling price − base price`, for either sale type.

Fixed catalog products do **not** use the ₱45/100 rule — they use the exact customer
price stored in the final price manifest, and always use GAME_GIFT rates.

## Two sale modes

**Catalog Sale** — pick a game, search a product, set quantity. Robux Cost, Customer
Price, Base Cost, Staff Commission and Business Net are previewed before you add.
Product prices come from the final fixed-product price manifest.

**Manual Gift Sale** — pick a **Sale Type** (`GAME_GIFT` or `VIA_PLUS`), enter a
Description and a Robux amount. The form relabels itself per sale type: `GAME_GIFT`
shows **Robux Cost**, while `VIA_PLUS` shows a prominent **Robux Amount** input
(placeholder *Enter Robux amount*) under the heading **VIA_PLUS Sale**, with quick
example chips (100 / 200 / 500 / 1000 / 2500 / 5000). Description is required for
GAME_GIFT and optional for VIA_PLUS. Leave *Actual Selling Price* blank to use the
default rate for that sale type (`robux × ₱45/100` for GAME_GIFT, `robux × ₱75/100`
for VIA_PLUS), or type an amount to override it. Staff commission always comes from
`robux × ₱5/100` either way. The submit button reads **Add GAME_GIFT Sale** or
**Add VIA_PLUS Sale** to match the selected type.

Quantity multiplies every total in both modes.

## Catalog source

`catalog.js` is a read-only extract of the fixed GAME_GIFT products:

- `owner-catalog.json` — 166 rows total → **156 `FIXED_GAME_GIFT` rows** kept
- `game-gift-price-manifest.v1.json` — **156 entries**, authoritative customer prices
  - SHA-256: `bfc7ff84b9d4d72e4f7d1e9e55e2b9ef94ab293d03b93e23d79f1297c945f355`
- Excluded: **7 VIA_GAMEPASS** rows and **3 deferred** rows

Each entry stores only game, category, title, slug, Robux gift cost and customer price
(centavos). No UUIDs, no confidential data.

Prices are stored as integer centavos and all money maths runs on integers, so every
figure rounds exactly to 2 decimal places.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure |
| `styles.css` | Dark dashboard styling (responsive) |
| `catalog.js` | 156 fixed GAME_GIFT products |
| `app.js` | Calculations, storage, filtering, CSV export |
| `README.md` | This file |

## Privacy

Everything runs locally in your browser. No server, no cloud storage, no account
credentials, no analytics, no external libraries.
