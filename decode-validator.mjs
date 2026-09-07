// Recover the field names isSignedTrustManifest() requires.
//
// dist/index.esm.js ships as a single obfuscated line: string literals live in a
// rotated table and are fetched through a decoder, so the field names are not
// greppable. Rather than reimplement the deobfuscator, we let the bundle decode
// itself: copy it, append a probe into its own module scope (by which point the
// rotation IIFE at the top has already run), and execute it.
//
// Index positions are read out of the live bundle, so this keeps working when the
// obfuscator reshuffles them between releases.
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
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

const version = SDK_VERSION;
const src = readFileSync(join(SDK_DIR, "dist", "index.esm.js"), "utf8");

const FN = "function isSignedTrustManifest(";
const start = src.indexOf(FN);
if (start === -1) {
  console.error(`isSignedTrustManifest not found in ${version} — bundle shape changed.`);
  process.exit(1);
}
const body = src.slice(start, start + 1500);

// Inside the function: `const <local> = <global>;` aliases the string decoder.
const alias = body.match(/const (_0x[0-9a-f]+)\s*=\s*(_0x[0-9a-f]+);/);
if (!alias) {
  console.error("could not locate the decoder alias — bundle shape changed.");
  process.exit(1);
}
const [, local, global] = alias;

// Every `<local>(0xNNN)` in the body is one decoded string the validator uses.
const indices = [...new Set(
  [...body.matchAll(new RegExp(`${local}\\((0x[0-9a-f]+)\\)`, "g"))].map((m) => m[1]),
)];

const probe =
  `\n;console.error("T3N_DECODE:"+JSON.stringify({` +
  indices.map((i) => `"${i}":${global}(${i})`).join(",") +
  `}));\n`;

const dir = mkdtempSync(join(tmpdir(), "t3n-decode-"));
const probed = join(dir, "probe.mjs");
writeFileSync(probed, src + probe);

const out = execFileSync(process.execPath, [probed], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  || "";
const line = (out.split("\n").find((l) => l.startsWith("T3N_DECODE:")))
  ?? execFileSync("/bin/sh", ["-c", `node ${JSON.stringify(probed)} 2>&1 | grep '^T3N_DECODE:'`], { encoding: "utf8" }).trim();

const decoded = JSON.parse(line.replace("T3N_DECODE:", ""));

console.log(`sdk version: ${version}`);
console.log("strings referenced by isSignedTrustManifest():\n");
for (const [idx, str] of Object.entries(decoded)) console.log(`  ${idx.padEnd(8)} ${str}`);

// The table also encodes typeof-operands and the Array/String method names the
// validator calls, so drop those to leave only manifest field names.
const NOT_FIELDS = new Set([
  "object", "string", "number", "boolean", "undefined", "function", "symbol", "bigint",
  "isArray", "every", "some", "map", "filter", "length", "push", "call", "slice",
]);
const fields = Object.values(decoded).filter((s) => !NOT_FIELDS.has(s));
console.log(`\nrequired manifest fields: ${fields.join(", ")}`);

const served = Object.keys(await (await fetch("https://cn-api.sg.testnet.t3n.terminal3.io/api/trust-manifest")).json());
const missing = fields.filter((f) => !served.includes(f));
console.log(`served by testnet       : ${served.join(", ")}`);
console.log(`\nMISSING: ${missing.length ? missing.join(", ") : "(none)"}`);
