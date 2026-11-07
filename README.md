# Microburbs Smart Buyer Sidebar

> A Chrome extension that puts independent, address-matched property facts **beside the listing** a buyer is already viewing on realestate.com.au or domain.com.au. No tab-hopping, no copy-and-paste.

Built for the Microburbs "Chrome extension" challenge: *show Microburbs facts beside the listing a buyer is viewing on a property site.*

**Contents**

- [Description](#description)
- [What we built](#what-we-built)
- [Who it helps](#who-it-helps)
- [The data](#the-data)
- [The clever step](#the-clever-step)
- [How to run it](#how-to-run-it)
- [Project structure](#project-structure)
- [Privacy and permissions](#privacy-and-permissions)
- [Known limitations and next steps](#known-limitations-and-next-steps)
- [Credits](#credits)

---

## Description

### Why we built it

A listing page tells a buyer what the agent wants them to see: photos, an asking price range and a few headline numbers. Everything else a careful buyer needs lives somewhere else:

- *What is it actually worth?* An independent estimate, not the asking price.
- *What did similar homes sell for?* Usually found by searching sold listings by hand.
- *Is it exposed to flood, bushfire or other hazards?* Often buried in council maps or insurance quotes.
- *What is nearby?* Schools, transport and shops, which means more tabs and more maps.
- *If I buy it to rent out, does it stack up?* A separate calculator and a guess at the rent.

Buyers end up with a dozen tabs open and still do not trust that each tool is looking at the same address.

### What it solves

The sidebar **matches the home on screen to an official GNAF address ID** and then shows the right Microburbs facts in one panel, next to the listing. The buyer never leaves the page, never retypes an address and never has to wonder whether the numbers belong to a different property.

It also respects that some data is **pay-per-call**. Cheap, always-needed facts load automatically. Paid or heavier lookups only run when the buyer opens the tab that needs them, and each result is cached for that property.

### Who we target

- **Home buyers** browsing realestate.com.au and domain.com.au, especially first-home buyers and people buying in an unfamiliar suburb or from interstate or overseas.
- **Property investors** who want yield, cash flow and gearing at a glance before they enquire.
- **Buyer's agents and advisers** who want a fast first-pass check on value, comparable sales and hazards.
- **Property-search extension owners**, as a drop-in way to add trusted Microburbs data in front of an existing audience.

---

## What we built

A Manifest V3 Chrome extension. On a property detail page it detects the address, matches it, and opens a panel with five tabs.

| Tab | What the buyer sees | When it loads |
| --- | --- | --- |
| **Overview** | Estimated value with price range and confidence, dwelling type, land area, bedrooms, bathrooms and car spaces. An interactive map of the home and nearby amenities, with a **radius control (100 m to 2 km)** and walking routes when you tap an icon. | Automatically |
| **Details** | Nearest train, tram, bus and ferry. Nearest supermarket, restaurant, café and green space. Schools with distance, sector, level and ranking labels. | On tab open (shared with the map) |
| **Investment** | Negative gearing status, gross yield, default LVR and **net cash flow per year** at 80% and 105% LVR (with a weekly figure). The latest rent observation and the yield it implies on the estimate. A warning when the rent estimate is flagged as suspect. | On tab open |
| **Comparables** | A map of **recently sold similar homes** with price tags. Count, median price, and how this home's estimate compares to the median. A list sorted newest first. Tap a sale to see price difference vs the estimate, distance and layout difference (bedrooms, bathrooms, cars) vs this home. | On tab open |
| **Risks** | A plain-English banner (*Check these before buying*, *A few flags to check*, or *No mapped hazards*). Distance "ladders" for bushfire, flood, landslide, historical flood, erosion, environmental overlays, HV power lines, heritage, mobile black spots and public housing. A short "worth checking" list for anything on the property. | On tab open |

Other touches:

- A **popup** lets you look up any address or GNAF ID manually.
- The panel can be **minimised** or closed so it never blocks the listing.
- Every tab ends with a short, honest caveat (estimate, not an asking price; not financial advice; not a site inspection).
- All text is written in Australian English.

---

## The data

Everything comes from the **Microburbs property API**, keyed by the official **GNAF** address ID.

| Purpose | Endpoint | Used by |
| --- | --- | --- |
| Match an address to a GNAF ID | `GET /v1/geocode/address?address=` | Address matching |
| Automated valuation (AVM) | `GET /v1/properties/{gnaf_id}/valuation/avm` | Overview |
| Property basics (beds, baths, parking, type, land area) | `GET /v1/properties/{gnaf_id}/basics/all` | Overview |
| Schools | `GET /v1/properties/{gnaf_id}/schools/all` | Details |
| Amenities within a radius | `GET /v1/properties/{gnaf_id}/amenities/nearby?radius_m=2000` | Overview map, Details |
| Public transport within a radius | `GET /v1/properties/{gnaf_id}/transport/nearby?radius_m=2000` | Overview map, Details |
| Negative gearing and cash flow | `GET /v1/properties/{gnaf_id}/valuation/negative-gearing` (20c per call) | Investment |
| Latest rent observation | `GET /v1/properties/{gnaf_id}/rent-history-latest` | Investment |
| Comparable sales (CMA set) | `GET /v1/properties/{gnaf_id}/comparables/cma-comp-set` (60c per call) | Comparables |
| Hazard and neighbourhood overlays | `GET /v1/properties/{gnaf_id}/risks/all` | Risks |

Prices shown above are the per-call costs published in the Microburbs API docs for those two endpoints. Check the docs for the rest.

Supporting services (no Microburbs data):

- **OpenStreetMap** raster tiles for the base map, with automatic fallback to Esri World Street Map and OpenStreetMap France if tiles fail to load.
- **routing.openstreetmap.de** (foot profile) for walking routes. If routing is unavailable the map draws a straight dashed line instead.
- **Leaflet** for the map.

---

## The clever step

**Match the home on screen to a GNAF ID, then use that ID as the single join key for every fact, and only pay for what the buyer actually opens.**

```text
 Listing page (domain.com.au / realestate.com.au)
        |
        |  clean address
        v
   content.js  ---------- postMessage ----------->  map.html iframe (Leaflet)
        |
        |  FETCH_PROPERTY_SUMMARY on arrival, then one message
        |  per tab opened: nearby, gearing, rent, comps, risks
        v
   background.js (service worker, holds the API key)
        |
        |  1. geocode the address to a GNAF ID
        |  2. AVM and basics, then tab data, all keyed by that same GNAF ID
        v
   Microburbs API
```

What makes it work in practice:

1. **Reliable address extraction.** The address is read from the listing's own title elements and cleaned with a pattern that requires an Australian state, strips the postcode and rejects SEO noise such as "Properties for Sale". On Domain, the extracted address must also match the URL slug, which stops stale text from the previous listing being used after a single-page-app navigation.
2. **One ID, many datasets.** After the geocode step, every endpoint is called with the same GNAF ID, so valuation, comparables, risks and amenities are guaranteed to describe the same property.
3. **Cost-aware loading.** The valuation and basics load on arrival. Amenities load in the background for the map. Gearing, rent, comparables and risks wait until their tab is opened. Results are cached per property, shared between tabs where possible (the Comparables tab reuses the Overview map's location data), and a failed call is not cached so it can be retried.
4. **Built for single-page apps.** The extension watches for URL changes, retries address extraction for several seconds while the page renders, and discards any response that arrives after the buyer has moved to another listing.
5. **What you see is what was measured.** The map filters points by straight-line distance from the same coordinates it draws, so every icon sits inside the radius circle. Results are turned into buyer-readable cues, such as *estimate vs median sale*, *sale price vs estimate*, *layout difference vs this home*, and *on property / within 250 m* hazard flags.
6. **The key never touches the page.** All API calls go through the extension's service worker. The listing site's scripts cannot see the request or the key, and the map runs in its own extension iframe so the host page's CSS cannot break it.

---

## How to run it

### Requirements

- Google Chrome (or another Chromium browser that supports Manifest V3)
- A Microburbs API key

### 1. Get the code

```bash
git clone <this-repo-url>
cd <repo-folder>
```

Leaflet is included in `lib/` (`leaflet.js` and `leaflet.css`). If you ever need to restore it, download Leaflet 1.9.x and place both files there.

### 2. Add your API details

Open `background.js` and set the two constants at the top:

```js
const API_BASE = "https://api.microburbs.com.au/v1";   // or the base URL you were given
const API_KEY  = "YOUR_MICROBURBS_API_KEY";
```

Do not commit a real key to a public repository.

If your base URL host is different from `api.microburbs.com.au`, add it to `host_permissions` in `manifest.json` as well, for example `"https://your-api-host.example/*"`.

### 3. Load the extension

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the project folder (the one that contains `manifest.json`).

### 4. Try it

**On a listing**

1. Open a property detail page, for example any listing on `domain.com.au` or `realestate.com.au`.
2. The Microburbs panel appears at the top right after a moment.
3. Switch tabs. Gearing, comparables, rent and risks load when you open them.

**By searching**

1. Open any realestate.com.au or domain.com.au page.
2. Click the extension icon, type an address or a GNAF ID, then press **Look up**.

Sample lookups:

| Type | Example |
| --- | --- |
| Address | `304/9 Crystal Street, Waterloo NSW` |
| Address | `27 Arlington Street, Belmont North NSW` |
| Address | `Unit 105, 8 Sam Sing Street, Waterloo NSW` |
| GNAF ID | `GANSW710347863` |

GNAF IDs are recognised by their format (for example `GANSW…`, `GAWA_…`, `GAACT…`). Anything else is treated as an address.

### 5. After editing code

Click **Reload** on the extension in `chrome://extensions`, then refresh the listing page. Content scripts do not update on their own.

### Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Panel shows an API error | Check `API_KEY` and `API_BASE` in `background.js`. Open the service worker console from `chrome://extensions` to see the full request and response. |
| Panel does not appear | You may be on a search results page. The panel only opens on a single property page. Use the popup to look up an address manually. |
| Map area is grey | The base map tiles could not load. The map tries two fallback providers automatically. Check your network or any content blocker. |
| Some tabs say "Not available" | Not every property has every dataset (for example, an AVM or a rent observation). The panel says so rather than guessing. |

---

## Project structure

```text
.
├── manifest.json        # MV3 manifest: permissions, content script, popup, service worker
├── background.js        # Service worker: all API calls, message router, safe error handling
├── content.js           # Address detection, sidebar UI, tabs, caching, map messaging
├── styles.css           # Sidebar styling (Microburbs "real facts" look)
├── popup.html           # Manual address / GNAF lookup
├── popup.js
├── map.html             # Map page loaded in an iframe inside the sidebar
├── map.js               # Leaflet map: amenities mode and sold-comparables mode
└── lib/
    ├── leaflet.js
    └── leaflet.css
```

How the pieces talk to each other:

- `content.js` sends named messages (`FETCH_PROPERTY_SUMMARY`, `FETCH_NEARBY`, `FETCH_NEGATIVE_GEARING`, `FETCH_RENT_LATEST`, `FETCH_CMA`, `FETCH_RISKS`, `FETCH_PROPERTY_BY_GNAF`) to `background.js`.
- `background.js` calls the API and always replies, even on failure, with `{ error, step, message }` so the UI can show a useful message.
- `content.js` and `map.js` exchange map data and selections with `postMessage`.

---

## Privacy and permissions

- **What leaves the browser:** the address (or GNAF ID) of the listing being viewed, sent to the Microburbs API. Map tile and walking-route requests go to the map providers listed above.
- **What we do not do:** no accounts, no analytics, no tracking, and no copying of listing content. The panel says so: *Address matched. No listing copied.*
- **Host access** is limited to domain.com.au, realestate.com.au, the Microburbs API and the map services.

---

## Known limitations and next steps

We would rather be upfront about these.

- **Address matching takes the top geocode result.** For unit or strata addresses this can pick a neighbouring record. Next step: cross-check state, postcode, unit number and bedroom count against the listing before accepting a match, and show a "not sure" state when they disagree.
- **Not every property has every dataset.** A missing valuation or rent observation is shown as "Not available".
- **The rent history response shape is inferred.** The Investment tab looks for common field names and falls back to showing the raw fields. It should be tightened once the schema is confirmed.
- **Comparable `dist_score` is not used yet** because its meaning is not confirmed. Comparables are sorted by sale date and distance is calculated from coordinates.
- **The API key ships inside the extension.** That is fine for a demo, but a production version should call a small backend that holds the key and applies rate limits.
- **Public map tiles are for light use.** A production version should use a licensed tile provider.
- **Scope:** Chrome, domain.com.au and realestate.com.au only, with Australian English text.

Ideas we would build next: an on/off switch per tab, a "compare with my budget" line, saved shortlists, and Firefox and Safari builds.

---

## Credits

- Property data and valuations: [Microburbs](https://www.microburbs.com.au)
- Map library: [Leaflet](https://leafletjs.com)
- Map data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors; fallback tiles © Esri and © OpenStreetMap France
- Walking routes: [routing.openstreetmap.de](https://routing.openstreetmap.de)

Estimates, comparables, cash-flow figures and hazard overlays are general information only. They are not a valuation, financial advice, an insurance quote, legal advice or a site inspection.
