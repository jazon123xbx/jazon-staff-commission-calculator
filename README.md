# Jazon Staff Commission Calculator

GAME_GIFT Sales & Staff Earnings — a lightweight internal calculator for Jazon Roblox
GAME_GIFT sales and staff commission payouts.

Plain HTML + CSS + vanilla JavaScript. No build step, no npm, no server, no database,
no authentication, no CDN, no network calls.

## How to use

1. Open `index.html` in any modern browser (double-click it).
2. Enter a **Staff Name** and press **Start New Calculation** in *Calculation Sessions*.
3. Choose **Catalog Sale** (fixed products) or **Manual Gift Sale** (your own Robux cost).
4. Fill in the fields and press **Add Sale** — while that staff member's calculation is
   active, every new sale is attached to that session automatically.
5. Press **Finish Calculation** when the batch is done. Its final totals open immediately.
6. Watch the all-time summary cards, **Staff Earnings** and **Daily Sales History** update.
7. Press **Export CSV** for the current history filter, or **Export This Calculation (CSV)**
   from an open session.

Sales and calculation sessions are saved in your browser's `localStorage`, so they
survive a page refresh. Use **Clear All Sales** to wipe everything (it asks for
confirmation first). Use the **Staff Filter** in the top bar or in *Daily Sales History*
to show one staff member only — dashboard totals, earnings, history and the CSV export
all follow that filter.

## Calculation sessions

A session is one staff member's calculation batch:

- unique session ID, staff member, per-staff session number, start date/time,
  end date/time and status (`Active` / `Finished`)
- new sales are attached only to the **active** session of that exact staff member
- a finished session never receives new sales; starting the same staff again creates
  a **new** session, even on the same date
- a staff member cannot have two active sessions at once
- session totals are calculated from only that session's sales and are never mixed
  with daily or lifetime totals

The *Active Calculation* banner stays visible at the top of the calculator until the
session is finished. **View Previous Calculations** lists every session; **View** opens
the full details: date, staff, session number, start/end time, every sale, and session
totals for gross sales, Robux, business base, staff commission, owner earning, extra
margin and business net.

## Daily sales history

History is grouped by each sale's actual saved timestamp using **Asia/Manila** calendar
dates. Dates appear above their groups with day totals, newest transactions first.

Filters: **All Dates**, **Today**, **Yesterday**, **Custom Date** and **Staff Member**.
When a specific date is selected, a separate **Daily Totals** panel appears. Daily and
session totals are intentionally kept apart from the all-time summary cards.

Older sales without a session ID are never rewritten or assigned to an invented
session. They appear under their original transaction date in
**Earlier Sales — Legacy History**, with their original figures intact.

## Locked rates

| Sale type | Business Base | Gross sale (customer price) | Staff commission |
| --- | --- | --- | --- |
| GAME_GIFT (catalog + manual) | ₱40 per 100 Robux | ₱45 per 100 Robux | ₱5 per 100 Robux |
| VIA_PLUS (manual only) | ₱70 per 100 Robux | ₱75 per 100 Robux | ₱5 per 100 Robux |

```
GAME_GIFT:  business base = robux × 40 / 100   gross = robux × 45 / 100   commission = robux × 5 / 100
VIA_PLUS:   business base = robux × 70 / 100   gross = robux × 75 / 100   commission = robux × 5 / 100
```

## Money column meanings

| Column | Meaning |
| --- | --- |
| **Gross Sale** | total amount paid by the customer |
| **Business Base** | standard business share based on the base rate (₱40/100 or ₱70/100) |
| **Staff Commission** | amount earned by staff |
| **Extra Margin** | `Gross Sale − Business Base − Staff Commission` |
| **Business Net** | `Gross Sale − Staff Commission` (= Business Base + Extra Margin) |

Commission is always calculated **independently from Robux**. It is never derived as
`selling price − base price`, for either sale type.

History rows are **derived at render time** from the stored gross / base / commission
fields, so records written before this change display correctly without any migration —
stored records are never rewritten on page load, and old JSON backups stay restorable.

Fixed catalog products do **not** use the ₱45/100 rule for gross — they use the exact
customer price stored in the final price manifest, and always use GAME_GIFT rates for
business base and commission.

## Two sale modes

**Catalog Sale** — pick a game, search a product, set quantity. Robux Cost, Gross Sale,
Business Base, Staff Commission, Extra Margin and Business Net are previewed before you
add. Product prices come from the final fixed-product price manifest.

**Manual Gift Sale** — pick a **Sale Type** (`GAME_GIFT` or `VIA_PLUS`), then enter a
Description, a Robux amount and a Quantity. There is **no selling-price override**: gross
always comes from the rate for that type (`robux × ₱45/100` for GAME_GIFT,
`robux × ₱75/100` for VIA_PLUS) and commission from `robux × ₱5/100`. The form relabels
itself per sale type: `GAME_GIFT` shows **Robux Cost**, while `VIA_PLUS` shows a prominent
**Robux Amount** input (placeholder *Enter Robux amount*) under the heading **VIA_PLUS
Sale**, with quick example chips (100 / 200 / 500 / 1000 / 2500 / 5000). Description is
required for GAME_GIFT and optional for VIA_PLUS. The submit button reads **Add
GAME_GIFT Sale** or **Add VIA_PLUS Sale** to match the selected type.

Quantity multiplies every total in both modes.

## Staff tips

**Add Staff Tip** records an extra peso amount that is *not* a Robux sale: the tip is
stored as its own history entry (`Type = TIP`, Robux `0`, Qty `1`, Gross = tip,
Business Base `₱0`, Commission = tip, Extra Margin `₱0`, Business Net `₱0`). It flows
straight into Staff Earnings, Gross Sales and Total Sales, leaves Total Robux /
Business Base / Business Net untouched, and works with the staff filter, CSV export and
JSON backup/restore. An empty note is stored as `Staff Tip`.

## Backups

| Button (in Daily Sales History) | What it does |
| --- | --- |
| **Download JSON Backup** | Downloads `jazon-sales-backup-YYYY-MM-DD-HHMM.json` containing the full sales array **and** all calculation sessions, including sale-to-session associations. |
| **Restore JSON Backup** | Opens a local `.json` file picker. Both the current object backup and older bare sales-array backups are accepted. Every sale and session record is validated first — malformed, unrelated or partially invalid files are rejected outright with no import. You are then asked for confirmation before anything is replaced. |
| **Restore Last Backup** | Recovers from the automatic sales snapshot below and, when available, the automatic session snapshot (asks for the same confirmation). If no snapshot exists yet it simply says so. |

Session metadata lives separately in `jazon.staff.commission.sessions.v1`. Sales keep
using the same `jazon.staff.commission.sales.v1` key and the same record fields; a new
sale may only gain an optional `sessionId`. No old sale is migrated, reassigned or
rewritten. A legacy sales-only backup restores its sales exactly as before and keeps
the current calculation-session records instead of deleting them.

**Automatic snapshot** — every successful save first copies the current *valid* history
to `jazon.staff.commission.sales.backup.v1`, then writes the new history to the main key.
Corrupt or empty data is never copied into the backup.

**Load-failure protection** — if the main key cannot be read, the stored value is left
untouched (never replaced with an empty array), a warning appears at the top of the page,
and new sales are not written until you restore.

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
| `app.js` | Calculations, calculation sessions, date grouping, storage, filtering, CSV export |
| `tests/run-tests.js` | Deterministic local tests using a fake DOM/localStorage (`node tests/run-tests.js`) |
| `README.md` | This file |

## Privacy

Everything runs locally in your browser. No server, no cloud storage, no account
credentials, no analytics, no external libraries.
