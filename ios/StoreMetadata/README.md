# App Store metadata

What App Store Connect asks for besides the binary, kept here so a submission
starts from a document rather than from a blank form. The copy is versioned;
the screenshots that illustrate it are rebuilt rather than committed.

## Layout

| File | What it is |
| --- | --- |
| `en.md`, `ru.md` | The listing itself: name, subtitle, description, keywords, what's new. |
| `review-notes.md` | What the reviewer is told: no account needed, and why. |
| `screenshots/` | Built by `ios/Scripts/capture-screenshots.sh`, ignored by git. |

## Screenshots

```
ios/Scripts/capture-screenshots.sh                     # every device, both languages
ios/Scripts/capture-screenshots.sh "iPhone 17 Pro Max" # one device
```

The run drives `StoreScreenshotUITests` against the Mock scheme, whose release
is deterministic — the same run gives the same numbers on the home screen and
the same ring on the progress screen, in both languages.

It is not part of any test plan that gates a pull request: it asserts no
product rule, and a screenshot run is minutes of tapping per device. **Look at
what it produced before uploading it.** A screenshot of a half-loaded screen
passes every check in the script.

## Before the first submission

- The app's store name is decided here and must match `CFBundleDisplayName`.
- `MARKETING_VERSION` is `0.1.0`; a listing at 0.1.0 reads as pre-release.
- The privacy labels are filled from the table in
  [`docs/ios/release-checklist.md`](../../docs/ios/release-checklist.md), which
  maps them one to one onto `PrivacyInfo.xcprivacy`.
- The support and marketing URLs point at the published site (`site/`).
