# Notes for App Review

Pasted into the "Notes" field of the submission. Short on purpose: a reviewer
reads dozens of these a day.

---

No account is needed to review this app. Sign-in exists so progress survives
a lost phone, and so a purchase can be restored on another device; everything
else — the catalogue, the training sessions, the progress screen and the
maps — works as a guest from the first launch, so no demo credentials are
provided.

If you would like to see the signed-in state, Sign in with Apple works with any
Apple ID, including a private-relay address; the account can then be deleted
from the account screen (the avatar in the top right of the Home tab), which
erases it immediately.

A few decks are locked behind a one-time purchase — look for the lock icon in
the catalogue. Buying one requires the signed-in state above; tapping Buy opens
Apple's own payment sheet, and in a reviewed build that runs against Apple's
sandbox, so no real charge is made. The deck unlocks immediately, and
"Restore Purchases" on the account screen replays it on a fresh install.

The app collects nothing optional by default. Product analytics and crash
diagnostics are two separate switches in Settings, both off until turned on.
There is no advertising, no advertising identifier and no tracking prompt.
Apple, not the app, handles the payment instrument for a purchase — no card
or other payment detail is ever collected by us.

Maps are Apple Maps, drawn by the system.

---

## Before pasting, check

- The account deletion path still lives behind the avatar → Account → Delete.
- The privacy policy link in the app resolves (`check-release-app.sh` enforces
  this for release builds).
- A paid deck's Apple product is ACTIVE and VALIDATED in the environment this
  build talks to, so Buy has something to purchase.
