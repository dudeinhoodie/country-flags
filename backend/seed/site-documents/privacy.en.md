# Privacy Policy

Vexi is an app for learning the flags of the world. This policy describes what the app collects, why, and what you can do about it. It is written from what the code actually does; nothing below is aspirational.

## Using the app without an account

You can use everything without signing in: the catalogue, training sessions, your progress and the maps. A guest is identified only by a random installation identifier generated on your device and kept in the system keychain. Your answers and progress stay on the device and are not uploaded.

## If you create an account

Signing in is optional and exists for one reason: so your progress survives a lost or replaced phone. You sign in with Apple or with Google. We never see your password — the provider returns an identity token, and the following is then stored on our servers:

- **Your email address**, as the provider reports it. If you use Sign in with Apple and choose to hide your address, we receive and store Apple's relay address instead — that is the provider's choice, not ours. The address identifies the account and lets you sign back in.
- **Your display name**, if the provider supplies one.
- **An account identifier** we generate.
- **Your learning progress**: which cards you have answered, how you rated them, and when they are due again.

When you sign in for the first time, the work you did as a guest is imported into the new account and the local guest copy is erased afterwards.

## Technical data our servers see

Every request from the app carries the app version, the platform and the language the phone is set to, so the server can answer in a form that build understands. Requests are logged with a random request identifier, the path, the result and how long it took — not with who sent them.

Each sign-in session is stored with a keyed hash of your IP address and of the app's network identifier string. It exists to notice a stolen session and for nothing else; the session is invalidated when you sign out and erased with the account. Sign-in attempts and a few other requests are limited per address; the counter keeps a hash of the address for at most a day.

## Optional analytics and diagnostics

Two things are off until you switch them on in Settings, separately from one another, and nothing is sent while they are off:

- **Product analytics** — which screens are opened and how sessions go, tied to a pseudonymous identifier and to the app version, build, platform and language. It does not include your answers, your email address or anything you sign in with.
- **Diagnostics** — crash reports and launch or hang measurements collected by iOS, scrubbed before they leave the device.

Turn either off and anything still waiting to be sent is deleted on the device.

## What the app does not do

- No advertising, no advertising SDK and no advertising identifier (IDFA). The app never asks for tracking permission.
- No third-party analytics. Everything described above goes to our own servers and nowhere else.
- No location, camera, microphone, contacts, photos or health data. The app declares no such permissions at all.
- No purchases and no payment data. There is nothing to buy in the app, so no card, Apple Pay or other payment information ever reaches us.
- No selling or sharing of personal data, and no profiling.

## Maps

The country map inside the app is Apple Maps, drawn by the operating system. Apple's own privacy policy governs what Apple receives when a map is displayed; the app sends Apple no personal data of yours.

## Reminders

Study reminders are optional local notifications scheduled on your device. Turning them on asks iOS for permission; nothing about them leaves the phone.

## Where the data is kept

Account data is stored in Frankfurt, Germany: the application runs in Google Cloud (europe-west3) and the database is hosted by Neon in Amazon Web Services (eu-central-1). Both act as our hosting providers and process the data on our instructions.

## How long it is kept

- Account data — until you delete the account.
- Sign-in sessions — until you sign out, and in any case no longer than 30 days without use.
- Product analytics — no longer than 13 months.
- Diagnostics and error reports — no longer than 90 days.

## Deleting your account

Open the account screen in the app and choose to delete the account. The deletion runs immediately: your progress, your sign-in methods, your devices and your settings are erased, and the app returns you to guest mode. It cannot be undone, and there is no separate request to make of us.

What remains is a technical record that an account with this internal identifier existed and when it was deleted. It holds no email address, no name and no progress.

You do not need an account to keep using the app afterwards.

## Your rights

Depending on where you live you may have the right to access, correct or erase your data, to object to its processing, or to receive a copy of it. Both are available directly in the app: the account screen prepares a copy of your data that you can save or share, and it is where you delete the account, as described above. For anything else, write to us.

## Children

The app is not directed at children under 13 and we do not knowingly collect data from them. It contains no chat, no user-generated content and no links out to the open web.

## Changes

If this policy changes in a way that matters, the date at the top changes with it and the new version is published here before it takes effect.

## Contact

Questions about this policy or about your data: [slmyskov@gmail.com](mailto:slmyskov@gmail.com).
