// Version matrix across published @terminal3/t3n-sdk releases.
//
// Installs each version into a scratch directory and calls fetchTrustedManifest()
// against live testnet. Prints an OK/FAIL table and reports the boundary.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERSIONS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["4.46.0", "5.0.0", "5.1.0", "5.2.0", "5.3.0", "5.4.0", "5.5.0", "5.6.0", "5.8.0", "5.10.0"];

const dir = mkdtempSync(join(tmpdir(), "t3n-bisect-"));
execFileSync("npm", ["init", "-y"], { cwd: dir, stdio: "ignore" });
execFileSync("npm", ["pkg", "set", "type=module"], { cwd: dir, stdio: "ignore" });

writeFileSync(join(dir, "probe.mjs"), `
import { setEnvironment, fetchTrustedManifest } from "@terminal3/t3n-sdk";
setEnvironment("testnet");
try { await fetchTrustedManifest("testnet"); console.log("OK"); }
catch (e) { console.log("FAIL " + e.message); }
`);

const results = [];
for (const v of VERSIONS) {
  try {
    execFileSync("npm", ["install", "--silent", "--no-audit", "--no-fund", `@terminal3/t3n-sdk@${v}`],
      { cwd: dir, stdio: "ignore" });
  } catch {
    console.log(`${v.padEnd(9)} SKIP  (install failed)`);
    continue;
  }
  let line;
  try {
    line = execFileSync(process.execPath, ["probe.mjs"], { cwd: dir, encoding: "utf8" }).trim();
  } catch (e) {
    line = "FAIL " + String(e.stdout || e.message).split("\n")[0];
  }
  const ok = line.startsWith("OK");
  results.push({ v, ok });
  console.log(`${v.padEnd(9)} ${ok ? "OK" : line.slice(0, 90)}`);
}

const lastOk = [...results].reverse().find((r) => r.ok);
const firstBad = results.find((r) => !r.ok);
if (lastOk && firstBad) {
  console.log(`\nlast working : ${lastOk.v}`);
  console.log(`first broken : ${firstBad.v}`);
  console.log(`workaround   : npm install @terminal3/t3n-sdk@${lastOk.v}`);
}
