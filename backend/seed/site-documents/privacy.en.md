# Privacy Policy

Vexi is an app for learning the flags of the world. This policy describes what the app collects, why, and what you can do about it. It describes what the app does today, not plans for the future.

## Who is responsible

Vexi is developed and run by Vyacheslav Myskov, who is responsible for your data (the controller). You can reach him at [slmyskov@gmail.com](mailto:slmyskov@gmail.com).

## Using the app without an account

You can use everything without signing in: the catalogue, training sessions, your progress and the maps. A guest is identified only by a random installation identifier generated on your device and kept in the system keychain. Your answers and progress stay on the device and are not uploaded.

## If you create an account

Signing in is optional and exists for one reason: so your progress survives a lost or replaced phone. You sign in with Apple or with Google. We never see your password: the provider returns an identity token, and the following is then stored on our servers:

- **The identifier Apple or Google assigns to you.** This is what signs you in.
- **Your email address**, as the provider reports it. If you use Sign in with Apple and choose to hide your address, we receive Apple's relay address instead. We do not use the address to sign you in, to link accounts or to send you anything; it is kept with the sign-in record so that we can recognise your account if you write to us about it.
- **Your display name**, if the provider supplies one.
- **An account identifier** we generate.
- **Your learning progress**: which cards you have answered, how you rated them and when they are due again, together with the session history and awards that come from it, and your settings.
- **The phones you sign in on**: for each one, the app version, the language, the time zone and when it was last seen. The time zone lets your day's reviews be counted in your own day.

When you sign in, the work you did as a guest on this phone is imported into the account you signed in to, and the local guest copy is erased afterwards.

## Technical data our servers see

Every request from the app carries the app version, the platform and the language the app is shown in, so the server can answer in a form that build understands. Our own request log records a random request identifier, the path, the result and how long it took, and not who sent the request.

The hosting platform, Google Cloud, keeps its own log of every request, which includes the IP address and the User-Agent string: the name and version of the app and of iOS. That log is kept for 30 days and is used only to investigate failures and attacks.

Each sign-in session is stored with a hash of your IP address, computed with a secret key, and with the User-Agent string as the app sent it. They exist to notice a stolen session and for nothing else. Sign-in attempts and a few other requests are limited per address; the counter keeps a hash of the address for at most a day.

## Optional analytics and diagnostics

Two things are off until you switch them on in Settings, separately from one another, and nothing is sent while they are off:

- **Product analytics**: which screens are opened and how training sessions go. The events are tied to a pseudonymous identifier and to the app version, build, platform and language. They do not include your answers, your email address or anything you sign in with.
- **Diagnostics**: crash reports and launch or hang measurements collected by iOS, scrubbed before they leave the device.

Turn either off and anything still waiting to be sent is deleted on the device.

## What the app does not do

- No advertising, no advertising SDK and no advertising identifier (IDFA). The app never asks for tracking permission.
- No third-party analytics. Everything described above goes to our own servers and nowhere else.
- No location, camera, microphone, contacts, photos or health data. The app declares no such permissions at all.
- No purchases and no payment data. There is nothing to buy in the app, so no card, Apple Pay or other payment information ever reaches us.
- No selling of personal data and no profiling. We share it with no one except the providers named in this policy, who process it on our behalf.

## Maps

The country map inside the app is Apple Maps, shown by iOS itself. Apple's own privacy policy governs what Apple receives when a map is displayed; the app sends Apple no personal data of yours.

## Reminders

Study reminders are optional local notifications scheduled on your device. When you turn them on, iOS asks for permission to show notifications; nothing about them leaves the phone.

## Where the data is kept

Account data is stored in Frankfurt, Germany: the application runs in Google Cloud (europe-west3) and the database is hosted by Neon in Amazon Web Services (eu-central-1). They act as our hosting providers and process the data only on our instructions. Google, Neon and Amazon are US companies; their data processing terms govern how they handle the data, including any access from outside the European Union.

## Why we may process it

- Your account and your progress: to provide the service you asked for when you signed in.
- Product analytics and diagnostics: your consent, which you can withdraw in Settings at any time.
- The request logs, the session records and the sign-in limits: our legitimate interest in keeping the service and your account safe.

## How long it is kept

- Account data: until you delete the account.
- Sign-in sessions: a session stops working when you sign out or after 30 days without use. Its record, with the hashed address and the User-Agent string, is kept until the account is deleted.
- The hosting platform's request log: 30 days.
- Product analytics: no longer than 13 months.
- Diagnostics and error reports: no longer than 90 days.

Data you delete can remain in database backups until they are overwritten. Backups are kept for a limited time and are used only to restore the service after a failure.

## Deleting your account

Open the account screen in the app and choose to delete the account. The deletion runs immediately: your progress, your sign-in methods, your phones and your settings are erased, and the app returns you to guest mode. It cannot be undone, and there is no separate request to make of us.

What remains is a technical record that an account with this internal identifier existed, when it was deleted and which sign-in providers it used. It holds no email address, no name and no progress.

You do not need an account to keep using the app afterwards.

## Your rights

Depending on where you live, you may have the right to access your data, to receive a copy of it, to have it corrected or erased, and to object to its processing. You can delete your account yourself in the app, as described above. For a copy of your data or anything else, write to us and we will answer within one month.

You also have the right to complain to the data protection authority of the country where you live.

## Children

The app is not directed at children under 13 and we do not knowingly collect data from them. Where local law sets a higher age for agreeing to the processing of personal data, a child below that age needs a parent's permission to create an account. The app contains no chat and no content from other users, and the only web pages it opens are this policy and the terms of use.

## Changes

If this policy changes in a way that matters, the date at the top changes with it and the new version is published here before it takes effect.

## Contact

Questions about this policy or about your data: [slmyskov@gmail.com](mailto:slmyskov@gmail.com).
