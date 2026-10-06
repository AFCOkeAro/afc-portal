# Address / Postcode Evaluation — Nigeria Geocoding for Households, Branches & BSCs

**Issue:** AFC-150 · **Parent:** AFC-146 · **Owner:** CTO (MediaTech) · **Version:** v1 (2026-10-05)
**Board question:** are [postcode.gov.ng/integration](https://postcode.gov.ng/integration), [postcode.gov.ng](https://postcode.gov.ng/), [about.placepin.org](https://about.placepin.org/), and [loccodes.com](https://loccodes.com/) useful for the address system?
**Method:** public documentation only. **No live services were called, no accounts created, no forms submitted.** Items marked *unverified* could not be confirmed from public pages and must be verified before purchase or integration.

---

## 1. What we actually need

The geo requirement spans three record types:

| Record | Geo requirement | Accuracy needed |
| --- | --- | --- |
| **Household** | Unified address with a **map pin**; wedding date; members share the pin | Precise point (building/doorstep where possible) |
| **Branch** | Address + **geo coordinates**, map, outdoor photo | Precise point; street identity useful |
| **Bible Study Centre (BSC)** | Address + **geo**, property type/owner | Precise point; often informal locations, unnamed streets |
| Zone / Area / Conference Centre | Address + map + photo | Point or boundary; street/area identity |

Two distinct capabilities are needed and should not be conflated:
1. **Point capture** — latitude/longitude for a pin (the source of truth for "where").
2. **Address identity** — a street/area/postcode label and a way to normalise an address string (for search, dedupe, and reporting).

No single listed provider does both well, so the recommendation is a **combination**.

---

## 2. Provider findings

### 2.1 NIPOST — National Digital Alphanumeric Postcode System (`postcode.gov.ng`)
- **What it is:** the official government (NIPOST) digital addressing system. Assigns an **11-character code per addressable building**, hierarchical: State (2 letters) → LGA → District → Area → Building (e.g. `FC02A09DB09`). Includes GIS/location reference, not just postal codes.
- **Coverage:** stated aim "every addressable building in Nigeria"; nationwide launch **1 Oct 2026**. Actual completion and per-state coverage **unverified** — no published building count found.
- **API / integration:** documented indirectly via a developer dashboard (register → API key) and references to a "geo-enabled API", mobile SDKs, bulk/dataset, and a government-to-government corridor. **No public request/response schema or endpoint reference** was found.
- **Licence / cost:** free for individuals; **business/API/bulk/enterprise paid in Naira, per service agreement** (Terms §10). **Pricing unpublished — unverified.** Restricted licence: NIPOST owns the database/IP; no derivative databases without permission; attribution/data-use terms apply.
- **Ownership:** official NIPOST / government.
- **Fit:** best theoretical fit for **building-level** household/BSC postcodes and authoritative addressing; **not integration-ready today** (thin public docs, unpublished pricing, launch recency). *Unverified: lat/long availability per code, rate limits, whether the API is self-serve.*

### 2.2 PlacePin (`about.placepin.org`)
- **What it is:** an **open location protocol** — encodes a latitude/longitude into a nine-character code (3-3-3), ~**5 m** leaf cell, with three nested levels (~5 m / ~840 m / ~137 km). **No address, street, or building data.**
- **Coverage:** global by geometry (not Nigeria-specific). No household/branch registry.
- **API / integration:** **no hosted API or service by design** — an open algorithm + a reference JS library (`@placepin/core-js`, ~2.7 KB) that you self-host. No lookup endpoints, webhooks, or bulk service.
- **Licence / cost:** free. Spec **CC BY 4.0**, reference code **Apache-2.0**.
- **Ownership:** open-source (`placepin-org`); **v5 draft** — codes are not guaranteed durable until the spec freezes.
- **Fit:** a free, offline, precise **coordinate encoder**, but it **supplies no addresses** and so does **not** meet the household/BSC address requirement on its own. It also has **no checksum** — a typo yields a valid but wrong location. Pre-freeze spec is a stability risk.

### 2.3 LocCodes / Maiaddy (`loccodes.com`, `developers.maiaddy.com`)
- **What it is:** a private Nigerian **location-identity** system — one code **per street segment** (e.g. `FC2F 3KN`), plus notable standalone places. A resolve returns a GeoJSON `LineString` plus a `representative_point` (street midpoint).
- **Coverage:** claims **36 states + FCT**; public figures conflict ("100% of streets" / "1M+ streets" vs "10,000+ verified street loccodes"). **Exact coverage unverified**; the vendor acknowledges uneven data quality.
- **API / integration:** **documented REST.** Loccode API (free): `GET https://api.maiaddy.com/loccodeapi/api/v1/addresses/search/loccode/:loccode` with a Bearer API key, returning loccode, street name, addresses, LGA, state, country, and OpenStreetMap street info (`osmId`, length, highway type). Maimaps API adds search, routing, reverse-geocode, and `loccodes/nearest`. SDKs for JS, Python, Java, Go, Dart/Flutter. Rate limit ≈ **10 rps** (burst 20); loccode calls are never billed.
- **Cost:** Loccode API **₦0** (fair-use); Maimaps metered (1 credit = ₦1; reverse-geocode ₦3 after 2,000/mo; 10,000 map loads/mo free; 2–7 credits/request). Free/starter bundles.
- **Ownership:** private company Maiaddy (Aba, Nigeria); proprietary.
- **Fit:** the most **integration-ready** option — free, well-documented API + SDKs, designed for Nigerian streets including informal/unnamed ones, and returns lat/long. **Limit:** street-segment level, so a resolved point can be **hundreds of metres from a specific household/BSC**. Good for street identity and area normalisation; not sufficient alone for doorstep pins.

---

## 3. Comparison

| Provider | What it gives | Coverage | API | Cost | Licence | Integration effort | Meets household/BSC pin? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **NIPOST NDAPS** | Building-level postcode + GIS | National (launching; unverified) | API key + SDKs + bulk; **docs thin** | Free (individual) / **paid business, unpublished** | NIPOST-owned, restricted, agreement | Medium–high (forms; no public schema) | **Yes, once available** |
| **PlacePin** | Lat/lng point code (~5 m) | Global geometry | **None** (open spec, self-host) | Free | CC BY 4.0 / Apache-2.0 | Low to adopt; you build everything | No (no addresses) |
| **LocCodes (Maiaddy)** | Street-segment code + GeoJSON + lat/long | 36 states + FCT (claims vary) | **Documented REST + SDKs** | Loccode API free; Maimaps metered | Proprietary | **Low** | Partial (street level) |

---

## 4. Recommendation

**Adopt a combination, with our own pin as the source of truth.**

1. **Primary — our own map pin (authoritative).** Capture `latitude`/`longitude` via a map component (MapLibre/Leaflet + OpenStreetMap tiles, or Google Maps if the board prefers). A human drops/confirms the pin for each household, branch, and BSC. This is the **source of truth for "where"** and is provider-independent, so no vendor can change or lose it. Cost: free (OSM) or Google Maps usage. *This alone satisfies the map-pin requirement for every record.*
2. **Secondary — LocCodes (Maiaddy) for street identity.** Use its free Loccode API to normalise a captured address into a street code, LGA/state, and a representative point for **search, dedupe, and area reporting**. Do **not** rely on its midpoint as the household/BSC coordinate; keep it as a normalised label/metadata field. Integration effort is low (documented REST, key auth). *Fee risk is low (loccode lookups free); confirm terms in writing.*
3. **Optional / later — NIPOST NDAPS postcode field.** Add a stored `postcode` field and, when the NIPOST API and pricing become available and acceptable, populate it for authoritative building-level addressing and any government-facing reporting. Because our pin is authoritative, adopting NIPOST later is **additive, not a migration**. Request API access/pricing before committing.
4. **PlacePin — not required.** It provides coordinates only, which our own pin already covers, and carries a pre-freeze spec stability risk. Revisit only if the board wants an offline, human-readable coordinate code in addition to lat/lng.

### Integration shape (keeps the vendor boundary owned)
Mirror the communications pattern: an **`address_provider` adapter** behind one internal contract (`normalise(address) → {street_code, lga, state, point}`, `reverse(point) → address`). Config stores the provider name + `secret_ref`; the value is never stored. Swapping or adding a provider (LocCodes → NIPOST → both) is configuration, not a rewrite. The stored schema is: `geo` (lat/lng, authoritative), `map_pin`, `address` (free text), `street_code` (LocCodes), `lga`, `state`, `postcode` (NIPOST, nullable), `geo_provider`, `geo_captured_at`, `geo_captured_by`.

### Cost estimate
- Own pin (OSM tiles): ~$0 + hosting.
- LocCodes: ₦0 for loccode lookups within fair use; Maimaps only if we later use routing/map tiles (metered, budget a small monthly amount — *verify current rates*).
- NIPOST: **pricing unknown** — do not budget until published; treat as optional.

### Assumptions (must be verified before integration)
- **Unverified:** NIPOST per-state coverage, whether the API is self-serve, lat/long availability per code, and business pricing.
- **Unverified:** LocCodes' true street coverage and data quality; public claims conflict.
- **Assumption:** the board accepts OpenStreetMap tiles for internal mapping (or chooses Google Maps; cost differs).
- **Assumption:** we do not call any provider's live API during planning (board constraint) — this evaluation is documentation-based.

### Risks
| Risk | Impact | Mitigation |
| --- | --- | --- |
| NIPOST API unavailable/expensive | Medium | Own pin is authoritative; postcode is optional |
| LocCodes street-level accuracy | Medium | Keep midpoint as metadata only; human-confirmed pin wins |
| Informal/unnamed locations | Medium | Pin capture + free-text address; LocCodes helps where streets exist |
| Provider API/pricing change | Low | `address_provider` adapter; no lock-in |
| OSM tile usage policy | Low | Attribute; consider a paid tile host at scale |

**Bottom line:** build the map + pin capture into the portal and store lat/lng as the source of truth; use **LocCodes** for free street-level address normalisation; keep **NIPOST NDAPS** as an optional authoritative postcode when its API and pricing are confirmed; **PlacePin is not needed**.

---

## 5. How this maps to the data model

| Record | Fields |
| --- | --- |
| `households` | `address`, `geo` (lat/lng), `map_pin`, `street_code`, `lga`, `state`, `postcode` (nullable), `geo_provider`, `geo_captured_*` |
| `branches` | same geo fields + `outdoor_photo` |
| `bible_study_centres` | same geo fields + `property_type`, `property_owner`, `photo` |
| `conference_centres`, `zones`, `areas` | same geo fields + photo |

See [data-model-expansion](/AFC/issues/AFC-150#document-data-model-expansion) §2.

---

## 6. Open question added

| # | Question | Recommended default | Blocks |
| --- | --- | --- | --- |
| OQ-E5 | Address provider choice and map tiles | Own pin + LocCodes primary; NIPOST postcode optional/later; PlacePin not required; OSM tiles by default | Geo-map integration |

---

*Sources (public, accessed 2026-10-05): postcode.gov.ng (/, /integration, /faq, /terms, /privacy); about.placepin.org (/, /spec/spec, /why); loccodes.com; maiaddy.com (/, /about, /community, /developers); developers.maiaddy.com (pricing, loccodeapi reference, working-with-loccodes guide). Planning only — no live calls, no accounts, no secrets.*
