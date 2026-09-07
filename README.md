# `@terminal3/t3n-sdk` >= 5.3.0 cannot connect to testnet

**Every version from 5.3.0 onward fails at `fetchTrustedManifest("testnet")` before
authentication is attempted.** Since `npm install @terminal3/t3n-sdk` resolves to
`latest` (5.10.0), anyone following the [published
Quickstart](https://docs.terminal3.io/developers/adk/get-started/quickstart) today is
blocked at the first step.

```
Error: Trust manifest at https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest is malformed.
    at fetchTrustedManifest (.../@terminal3/t3n-sdk/dist/index.esm.js:2:413646)
```

The error says "malformed", so it reads like a bad server response or a credential
problem. It is neither. The endpoint returns HTTP 200 and valid JSON. The SDK's
validator requires a field the server does not publish.

---

## TL;DR for maintainers

`isSignedTrustManifest()` requires **`rtmr1_allowlist`**. The testnet manifest endpoint
does not emit it. One missing field fails the whole validation, and the caller is told
the document is malformed.

| | |
|---|---|
| First broken version | **5.3.0** (published 2026-08-28) |
| Last working version | **5.2.0** (published 2026-08-26) |
| `latest` at time of writing | 5.10.0 |
| Affected endpoint | `https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest` |
| Workaround | pin `@terminal3/t3n-sdk@5.2.0` (confirmed by Terminal 3 DevRel) |

---

## Root cause

`manifestToTrustAnchor()` reads three allowlists, and `isSignedTrustManifest()` gates on
all of them:

```js
// deobfuscated from dist/index.esm.js
function isSignedTrustManifest(m) {
  if (typeof m !== "object" || m === null) return false;
  return typeof m.cluster === "string"
      && typeof m.version === "number"
      && Array.isArray(m.peer_ids)         && m.peer_ids.every(x => typeof x === "string")
      && Array.isArray(m.rtmr3_allowlist)  && m.rtmr3_allowlist.every(x => typeof x === "string")
      && Array.isArray(m.rtmr1_allowlist)  && m.rtmr1_allowlist.every(x => typeof x === "string")
      // ^^^^^^^^^^^^^^ the server never sends this
}
```

What the server actually serves (HTTP 200, `content-type: application/json`):

```json
{
  "cluster": "testnet",
  "version": 1787800421,
  "peer_ids": ["QmPk4AtbFore74fJoP4CoS9Q96TvRvoQWR4VmkYtkBLmwz", "..."],
  "rtmr3_allowlist": ["+XO6nLsfqnTkX0VcNk9AaXAu79ErxURODtjuGOIF8Sk7OQYq3PVVsMG8jzDEeNJQ"],
  "signed_at": "2026-08-27T03:13:41Z",
  "signature": "387384a9186bd06ab8ce8e2fbb7055ae96202eac4ce57c68a771fba8421be2006dacc..."
}
```

`rtmr1_allowlist` is absent. Note the manifest was signed **2026-08-27**, one day before
5.3.0 shipped — consistent with the SDK hardening its attestation checks to cover RTMR1
ahead of the manifest publisher emitting that register.

Because `signature` covers the canonicalised payload, this cannot be fixed client-side by
injecting an empty array: adding the field changes the signed bytes and
`verifyManifestSignature()` then fails. **It has to be fixed by the manifest publisher,
or by relaxing the validator.**

---

## Reproduce

```bash
npm install
npm run repro     # fails on 5.10.0, the version a fresh `npm install` gives you
npm run bisect    # version matrix: 4.46.0 .. 5.10.0
npm run decode    # prints the exact field names the validator requires
```

### `npm run bisect` output

```
4.46.0   OK
5.0.0    OK
5.2.0    OK
5.3.0    FAIL  Trust manifest ... is malformed.
5.5.0    FAIL  Trust manifest ... is malformed.
5.6.0    FAIL  Trust manifest ... is malformed.
5.10.0   FAIL  Trust manifest ... is malformed.
```

### How the field names were recovered

`dist/index.esm.js` ships as one obfuscated line with a rotated string table, so the
field names are not greppable. `decode-validator.mjs` appends a probe into the module's
own scope after the rotation IIFE has run, then calls the SDK's own string decoder:

```
{"0xa16":"cluster","0x8e0":"version","0x5eb":"peer_ids",
 "0x5d8":"rtmr3_allowlist","0x57a":"rtmr1_allowlist",
 "0x397":"signed_at","0x343":"object","0x78c":"string","0x931":"number"}
```

---

## Suggested fixes, in order of preference

1. **Publish `rtmr1_allowlist` in the testnet manifest** and re-sign. Matches the intent
   of the 5.3.0 change and keeps the hardened attestation check.
2. **Treat a missing `rtmr1_allowlist` as an empty allowlist** in `isSignedTrustManifest`,
   for backward compatibility with manifests signed before the change.
3. **Improve the error either way.** "malformed" sends people hunting for a bad API key.
   Naming the missing field would have turned this into a one-minute diagnosis:
   `trust manifest missing required field 'rtmr1_allowlist'`.

## Also worth a look

Failures inside `fetchTrustedManifest` reject with the full obfuscated bundle in the
stack, which prints ~1.6 MB of minified JavaScript to the terminal and buries the actual
error message. Truncating the frame, or catching and rethrowing a clean error, would make
this far easier to debug.

## Impact

Two builders reported the symptom on the Superteam listing on 1 and 2 September 2026 and
neither got a reply; one asked whether a local mock would be acceptable instead. Anyone
who started after 28 August and installed `latest` hit this before they could authenticate.

## Environment

macOS 15 (darwin 25.6.0), Node v26.5.0, npm 11.17.0. Verified against testnet on
2026-09-06. Pinning 5.2.0 authenticates successfully and returns the expected
`did:t3n:...`.

## Status

Reported to Ian Chong, DevRel Lead at Terminal 3, on 2026-09-06. His reply on
2026-09-07:

> Thank for the heads up and yes please use sdkv5.2 for this challenge

So the 5.2.0 pin is the sanctioned configuration for the current challenge. The
underlying manifest/validator mismatch is still unfixed as of this writing, and a
plain `npm install @terminal3/t3n-sdk` still resolves to a version that cannot reach
testnet.

---

Reported by Matthew Karsten while working on the Superteam Earn T3N agent challenge.
