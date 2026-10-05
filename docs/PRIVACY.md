# StreamZ — Privacy notice (draft)

> **Status: draft for the owner to review and publish.** This describes what the app does with
> data today, written from the code rather than from intention. Before distributing the APK,
> read the "Not collected" and "Hosting and processors" sections against your own Firebase
> console settings, then publish it somewhere a user can reach without opening the app.
>
> Questions, removal requests and account requests: **Mirmajid@proton.me** or Telegram
> **@Mirmajid01**.

StreamZ is a private streaming client distributed as an APK outside app stores. It signs you
in with Google, checks that your account holds an active subscription, and plays titles from
external streaming servers. It collects the minimum it needs to do those three things.

## What is collected, and why

| Data | Where it lives | Why |
|---|---|---|
| Your Google account name, email and profile photo | Firebase Authentication + the `users` record | To recognise your account and tie one subscription to one person. |
| A one-way hash of the subscription key you activated | Firestore (`subscriptionKeys`) | So activation can be verified without ever storing a usable key. The plaintext key is never written to the database. |
| An installation identifier — a random value this device generates on first run | Your device (secure storage) + the `users` record | To detect a reinstall or a transfer to another phone. Rebindings are counted and capped; past a cap the app asks you to contact support rather than silently refusing you. |
| Which title you played, for how long, and how far through it you got | Firestore (`watchSessions`, `userDailyStats`) | So the operator can see whether the service is being used and which titles are watched. |
| A "last active" timestamp, refreshed while the app is in the foreground | Firestore (`users.lastActiveAt`) | To show who is currently using the service. |
| App version, and coarse app-usage events | Google Analytics for Firebase | To know which build a problem belongs to. |
| Crash and error reports | Firebase Crashlytics, if enabled in the build | To fix crashes. |

## What is **not** collected

- **No advertising identifier.** The app explicitly denies Google's advertising-storage consent
  on startup, so Firebase Analytics does not receive it.
- No contacts, no location, no call/SMS data, no photos or files from your device.
- No microphone or camera use for analytics. Those permissions are requested only if you join
  a watch-party call, which is disabled in this build.
- No passwords, authentication tokens, or session cookies are written to the database.
- No screen recording, no screenshots, and no keystroke capture.
- The app does not sell or share personal data, and there is no third-party advertising or
  tracking SDK in it.

## How long data is kept

Subscription records are kept while your subscription exists and afterwards as a key ledger, so
a revoked or expired key cannot be re-activated. Watch statistics are kept indefinitely in
aggregate form; individual watch sessions can be deleted on request. Ask by email or Telegram
and quote the address you signed in with.

## Where it is processed

Authentication, the database and analytics are provided by **Google Firebase** (Google LLC),
in the region configured for the StreamZ Firebase project. Distribution is by direct APK, so no
app store receives installation or usage data from this app.

## Your choices

- **Stop using the app.** Nothing continues to be recorded once the app is closed; presence and
  watch statistics only update while you are watching.
- **Ask for deletion or export** of your account and its records — same contacts as above.
- **Revoke Google access** at any time in your Google account settings; that ends sign-in but
  does not by itself erase the database rows, which is what the deletion request is for.

## Note on content

StreamZ hosts no content. Streams come from third-party servers that this app neither owns nor
operates; what those servers do with requests sent through them is governed by their own terms,
not by this notice. See **Settings → About → Disclaimer** in the app.
