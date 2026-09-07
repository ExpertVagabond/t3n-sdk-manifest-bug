// Minimal reproduction. Fails on @terminal3/t3n-sdk >= 5.3.0, succeeds on <= 5.2.0.
//
// Nothing here touches credentials: fetchTrustedManifest() runs before any key is
// used, which is the whole point. You do not need an API key to reproduce this.
import { setEnvironment, fetchTrustedManifest } from "@terminal3/t3n-sdk";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

// The SDK's package.json "exports" map is an allowlist that omits ./package.json and
// ./dist/*, so require.resolve() cannot reach them. Resolve on the filesystem instead.
function sdkDir(from = process.cwd()) {
  let d = from;
  for (;;) {
    const p = join(d, "node_modules", "@terminal3", "t3n-sdk");
    if (existsSync(p)) return p;
    const up = dirname(d);
    if (up === d) throw new Error("@terminal3/t3n-sdk not found - run: npm install");
    d = up;
  }
}
const SDK_DIR = sdkDir();
const SDK_VERSION = JSON.parse(readFileSync(join(SDK_DIR, "package.json"), "utf8")).version;
const MANIFEST_URL = "https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest";

setEnvironment("testnet");

// First: prove the server is fine. Valid HTTP 200 + parseable JSON.
const raw = await fetch(MANIFEST_URL);
const doc = await raw.json();
console.log(`sdk version      : ${SDK_VERSION}`);
console.log(`manifest HTTP    : ${raw.status} ${raw.headers.get("content-type")}`);
console.log(`manifest fields  : ${Object.keys(doc).sort().join(", ")}`);
console.log(`rtmr1_allowlist  : ${"rtmr1_allowlist" in doc ? "present" : "ABSENT  <-- the bug"}`);
console.log("");

// Then: the SDK rejects that same valid document.
try {
  const anchor = await fetchTrustedManifest("testnet");
  console.log("RESULT: OK — trust anchor resolved");
  console.log(JSON.stringify(anchor, null, 2));
} catch (e) {
  // The real stack embeds the whole obfuscated bundle (~1.6MB), so print only the message.
  console.error("RESULT: FAIL —", e.message);
  process.exitCode = 1;
}
