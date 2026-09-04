# Notes for App Review

Pasted into the "Notes" field of the submission. Short on purpose: a reviewer
reads dozens of these a day.

---

No account is needed to review this app. Sign-in exists only so progress
survives a lost phone; everything else — the catalogue, the training sessions,
the progress screen and the maps — works as a guest from the first launch, so
no demo credentials are provided.

If you would like to see the signed-in state, Sign in with Apple works with any
Apple ID, including a private-relay address; the account can then be deleted
from the account screen (the avatar in the top right of the Home tab), which
erases it immediately.

The app collects nothing optional by default. Product analytics and crash
diagnostics are two separate switches in Settings, both off until turned on.
There is no advertising, no advertising identifier and no tracking prompt.

Maps are Apple Maps, drawn by the system.

---

## Before pasting, check

- The account deletion path still lives behind the avatar → Account → Delete.
- The privacy policy link in the app resolves (`check-release-app.sh` enforces
  this for release builds).
