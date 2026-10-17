# Installation rotation: the fields, who hits the ceiling, and how to recover

Status: **read-only analysis.** No production document was read, written, or deleted while writing
this, and no rotation limit was changed. The counts in §4 are deliberately not filled in — see the
reason there — and the queries are given so the owner can run them in their own console session.

This matters for the signing migration because reinstalling after a key change is a rotation, and a
user at the ceiling cannot reactivate. That is a support failure the migration would create, and it
is preventable in advance.

## 1. The exact fields involved

| Field | Where it lives | Who writes it | What it means |
| --- | --- | --- | --- |
| `users/{uid}.installationId` | the user document | the app, inside the activation transaction | the installation the subscription is currently bound to |
| `users/{uid}.installationRotations` | the user document | the app | how many times that binding has moved |
| `users/{uid}.activatedAt`, `expiresAt`, `subscriptionId`, `status` | the user document | the app | the rest of the activation state; `expiresAt` is capped by the key (see the rule quoted below) |
| `config/app.maxInstallationRotations` | one config document | admin only, `0..100` (`firestore.rules:426-427`) | the ceiling every account shares |
| `devices/{uid}__{installationId}` | one document per installation | the app | the audit trail; `rotatedAt` records when an installation was retired |
| `subscriptionKeys/{keyHash}.installationId` | the key document | the app | the same binding, mirrored onto the key |

The client decides what a rotation is — `src/firebase/subscriptions/api.ts:232-264`:

```ts
const boundTo = typeof existing?.installationId === 'string' ? existing.installationId : null;
const rotating = boundTo !== null && boundTo !== installationId;
const rotations = num(existing?.installationRotations, 0);
// …
installationRotations: rotating ? rotations + 1 : rotations,
```

So a rotation is counted when a user document already exists, its stored `installationId` differs
from the one being written now, and the counter goes up by exactly one. **Reinstalling the app
produces a new `installationId`** because `src/firebase/installation/installationId.ts` keeps it in
`SecureStore`, which Android wipes on uninstall. Every person who uninstalls to escape the signature
mismatch therefore consumes one rotation.

## 2. The rule that refuses, and why nobody can undo it from the app

`firestore.rules`, the `users/{uid}` update branch:

```
&& rotationsOf(request.resource.data) >= rotationsOf(resource.data)
&& rotationsOf(request.resource.data) <= rotationCeiling()
&& (
  !('installationId' in resource.data)
  || request.resource.data.installationId == resource.data.installationId
  || rotationsOf(request.resource.data) == rotationsOf(resource.data) + 1
)
```

with:

```
function rotationCeiling() {
  return exists(/databases/$(database)/documents/config/app)
    ? config().maxInstallationRotations
    : 0;
}
function rotationsOf(data) {
  return 'installationRotations' in data ? data.installationRotations : 0;
}
```

Four consequences worth stating plainly:

1. **The counter is monotonic from the client.** A write that lowers it is refused by the first
   clause. The two staff/admin escape hatches in the same rule are narrower than they look:
   `isKeyStaff()` may change only `status`, `expiresAt`, `installationId`, `lastActiveAt`,
   `appVersion`, and `isAdmin()` only `role`. **Neither can touch `installationRotations`.**
2. **`allow delete: if false`** on `users/{uid}` — the app cannot clear a user document to reset the
   count, and `create` requires `installationRotations == 0` (`firestore.rules:112`), so the only
   way to get a fresh zero is a privileged write that the client rules do not govern.
3. **A missing `config/app` means a ceiling of 0**, i.e. one installation and no rotations at all —
   the comment in the rules calls this out deliberately ("a refusal rather than an open ceiling").
   The value in production today is unknown to this document; read it before planning anything.
4. The `expiresAt <= keyDocAfter(...)` clause in the same branch is the expiry cap released on
   2026-10-16; it is unrelated to rotations but lives in the same rule, so a recovery edit to this
   block must not disturb it.

The client surfaces the refusal as `CEILING` (`api.ts:239`), and `src/firebase/subscriptions/keyOutcome.ts`
maps that code to the message the user sees.

## 3. Who is at risk after a signing migration

Everyone who has ever reinstalled, plus everyone who reinstalls for the key change. That includes
any account that has already: switched phones, cleared app data (which wipes `SecureStore` the same
way an uninstall does), or reinstalled to escape a broken build — which has happened repeatedly on
this project while CI artifacts were being tested by hand.

With the default ceiling, a small number of reinstalls is enough to lock a legitimate subscriber
out, and the lockout looks identical to a bad activation key unless the message is specific — which
is one of the reasons the key-status work in this round distinguishes `CEILING` from `NOT_FOUND`.

## 4. Identifying accounts approaching the ceiling

**Read-only, no code, no credentials involved:** Firebase console → Firestore Database →
`users` collection → start a query, order `installationRotations` **descending**, limit 50. Compare
the top values against `config/app.maxInstallationRotations`. Anyone within one of the ceiling is a
migration casualty waiting to happen.

The equivalent REST call, run by the owner in their own authenticated shell (it prints a histogram
and never a uid or an email):

```bash
TOKEN="$(gcloud auth print-access-token)"   # or a freshly minted OAuth token in the operator's shell
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://firestore.googleapis.com/v1/projects/streamz-c98b9/databases/(default)/documents:runQuery" \
  -d '{"structuredQuery":{"from":[{"collectionId":"users"}],
       "orderBy":[{"field":{"fieldPath":"installationRotations"},"direction":"DESC"}],"limit":"200"}}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c={};for(const l of s.split("\n").filter(Boolean)){try{const j=JSON.parse(l);const f=j.document?.fields?.installationRotations?.integerValue;if(f)c[f]=(c[f]||0)+1}catch{}}console.log("rotations -> accounts",c)})'
```

**Why this document contains no numbers.** Two attempts to read production from this machine failed
and neither was worked around. The Firestore REST API rejected the token stored by the Firebase CLI
(`UNAUTHENTICATED: Request had invalid authentication credentials`), which means it is expired; the
CLI refreshes it internally, but refreshing it by hand means pulling a refresh token and client
secret out of `~/.config/configstore/firebase-tools.json` and through a shell pipeline — a route
that has leaked credentials into session output on this project before, so it is not taken to save
one query. The repository's `streamz-c98b9-firebase-adminsdk-*.json` key is not a fallback either:
it returns `PERMISSION_DENIED` for both Auth and Firestore reads, which is recorded in project
notes. The console query above needs five minutes of the owner's time and no credential handling at
all, so the counts are left to be filled in there.

## 5. Recovery options, narrowest first

| Option | Scope | What it costs | Verdict |
| --- | --- | --- | --- |
| **A. Edit `installationRotations` down for the specific uids** in the console | one field, named accounts | console/Admin writes bypass security rules, so this is the only way to lower a counter; history in `devices/` is untouched | **Recommended.** Narrowest possible, reversible, and it fixes exactly the accounts that will reinstall |
| **B. Raise `config/app.maxInstallationRotations`** | one document, every account, going forward | weakens the anti-replay intent for everyone, including future abuse | Acceptable as a *temporary* migration window if the value is lowered again afterwards; it does not help anyone already at the old ceiling |
| **C. Delete the affected `users/{uid}` documents** | whole documents | destroys subscription history, and `create` demands `installationRotations == 0` plus a key that is still `UNUSED` — a used key cannot rebind, so this can **lock the user out permanently** | Rejected |
| **D. Do nothing and tell users to contact support** | nothing | the failure looks like a bad key to the person experiencing it | Rejected |

Sequencing that makes A safe: take the histogram in §4 **before** announcing the migration, reset the
counters of the accounts that will reinstall, and only then ship the first production-signed build.
Resetting after the fact is fine too, but the user has to wait.

A design option worth considering instead of a manual sweep: a **migration grace** in the rules —
e.g. while `config/app.rotationGraceUntil` is in the future, an `installationId` change does not
have to increment the counter. It is a rule change, so it needs its own review and its own approval,
and it widens exactly the protection the counter exists to provide; the manual reset in A is smaller
and expires on its own.

## 6. What still has to be answered by the owner

1. The current value of `config/app.maxInstallationRotations` and the §4 histogram.
2. How many people actually hold an APK — the plan assumes yes, and each one is a rotation.
3. Whether to take option A, option B, or a dated grace rule, and who performs the console edit.
