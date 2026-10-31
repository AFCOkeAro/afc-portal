# Kiosk + badge print operations note (AFC-985 Phase 1)

How the Sunday team runs self check-in with printed badges, and what to buy.
All names in examples are synthetic fixtures, never real registrants.

## Recommended kit

- **Printer:** Zebra ZD220d class or Xprinter XP-420B/470B class, USB/LAN,
  203dpi. Premium alternative: Brother QL-1100/QL-820NWB.
- **Do NOT buy an 80mm receipt printer.** The badge QR needs a 25mm minimum
  print size plus quiet zone; 80mm paper cannot carry the badge layout.
- **Paper:** 76x102mm (3x4in) adhesive labels, plus one spare box on site.
  Fallback: 102x152mm (4x6in) labels with badge sleeves, then A4 cardstock
  (the badge route's `?size=large` / `?size=a4` switch covers both).
- **Tablets:** 2–3 kiosk tablets plus one staffed exception (welcome) desk.
- **Venue:** assume offline/flaky venue Wi-Fi — the kiosk queues check-ins
  on-device and replays when online. Bring power backup (power bank per
  tablet, printer on mains/UPS).

## QR spec

- Payload is the `ticket_code` string exactly as issued (signed
  eventID+attendeeID lives server-side; no new crypto).
- EC-M error correction, quiet zone from TicketQr padding, **min 25mm**
  printed.
- **Before bulk printing:** test-scan the first badge with **2 different
  phones** (iOS + Android) at arm's length. If either fails, stop and reprint
  the test — do not bulk-print unscanned badges.

## Sunday runbook

1. Open `/events/<id>/kiosk` on each tablet. The queued strip at the top
   must read "nothing waiting to sync".
2. Attendees type their ticket code (or full name) → confirm → checked in.
   Already-checked-in shows a notice, not an error — do not scan twice.
3. After success, tap **Print my badge** (`/events/<id>/badge`). One badge
   per page; check the size switch matches the loaded paper.
4. **Printer jam:** the check-in is already saved — it was stored BEFORE the
   print queued. Clear the jam, then **reprint from the queue**; never ask
   the attendee to check in again.
5. **Airplane-mode / venue Wi-Fi down:** the kiosk shows "Saved on this
   tablet" and a queued count. Keep checking people in. When the connection
   returns, tap **Sync now** (it also replays automatically). Intents that
   the server refuses (child code, missing consent, void badge, ambiguous
   name) settle as "needs the welcome desk" — walk those attendees over.
6. **Rose screens (blocked):** child codes and missing-consent rows go to the
   welcome desk with a person. The kiosk records nothing for them — do not
   attempt a kiosk override; there is none.
7. **Amber screen (tablet refused):** the tablet holds no check-in grant.
   Send attendees to the usherer's desk and get the tablet re-authorised.

## Beacon pilot

Explicitly NOT built in Phase 1. No Bluetooth/proximity check-in exists;
do not promise it to the welcome team.
