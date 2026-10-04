// Runs the Phase 0 checks from this machine: `npm run spike` (add --json for the full report).
import { runSpike } from "../src/lib/spike";

const report = await runSpike();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const c of report.checks) {
    const mark = c.skipped ? "SKIP" : c.ok ? "PASS" : "FAIL";
    console.log(`${mark}  ${c.name.padEnd(28)} ${String(c.ms).padStart(6)}ms  ${c.error ?? ""}`);
  }
  console.log(report.ok ? "\nAll checks passed or skipped." : "\nSome checks failed; rerun with --json for details.");
}
process.exitCode = report.ok ? 0 : 1;
