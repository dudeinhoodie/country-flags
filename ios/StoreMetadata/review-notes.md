# Notes for App Review

Pasted into the "Notes" field of the submission. Short on purpose: a reviewer
reads dozens of these a day.

---

No account is needed to review this app. On the first launch, tap "Continue
without an account": the catalogue, the training sessions, the progress
screen and the maps all work as a guest, so no demo credentials are provided.
Sign-in exists only so progress survives a lost phone.

If you would like to see the signed-in state, Sign in with Apple works with any
Apple ID, including a private-relay address. The account can then be deleted
from the Account screen — the avatar in the top left, on every tab — with
"Delete account". Deletion erases it immediately, and the app carries on as a
guest.

This version has no in-app purchases and no advertising, no advertising
identifier and no tracking prompt. The app collects nothing optional by
default: product analytics and crash reports are two separate switches in
Settings (the gear in the top right), both off until turned on.

The map on a country's page is Apple Maps, drawn by the system; the world map
on the Progress tab is drawn by the app.

---

## Before pasting, check

- The account deletion path still lives behind the avatar (top left) →
  Account → Delete account.
- The privacy policy link in the app resolves (`check-release-app.sh` enforces
  this for release builds).
- Purchases are still off in the environment this build talks to:
  `commerce.apple_iap.enabled` and `commerce.paid_decks.discovery.enabled` are
  false, so no lock, price or Buy button appears anywhere.
