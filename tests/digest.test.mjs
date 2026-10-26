import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeDigest } from "../plugins/opencode/scripts/lib/digest.mjs";
import { createJobRecord, runTrackedJob } from "../plugins/opencode/scripts/lib/tracked-jobs.mjs";

it("digest extracts commands and exit codes, bounds failures and distinguishes blocked", () => {
  const result = { changedFiles: ["hello.txt"], raw: { parts: [{ type: "tool", tool: "shell", state: { input: { command: "npm test" }, metadata: { exit: 7 }, error: Array(80).fill("original failure").join("\n") } }] } };
  const digest = makeDigest({ result, logPath: "full.log" });
  assert.equal(digest.status, "failed");
  assert.equal(digest.commandsRun[0].exitCode, 7);
  assert.equal(digest.testsSummary.failed, 1);
  assert.equal(digest.failures.length, 40);
  assert.equal(makeDigest({ error: new Error("Permission denied") }).status, "blocked");
});

it("reads real v2 nested command exit metadata and preserves command failure output", () => {
  const digest = makeDigest({ result: { raw: { part: { type: "tool", tool: "shell", state: { input: { command: "git status" }, metadata: { metadata: { exit: 9 } }, output: "original git error" } } } } });
  assert.equal(digest.commandsRun[0].exitCode, 9);
  assert.equal(digest.status, "failed");
  assert.deepEqual(digest.failures, ["original git error"]);
});

it("tracked jobs persist digest for successful and failed jobs with full logs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digest tiếng Việt "));
  const old = process.env.OPENCODE_COMPANION_DATA;
  process.env.OPENCODE_COMPANION_DATA = dir;
  try {
    const job = createJobRecord(dir, "task");
    const result = await runTrackedJob(dir, job, async ({ log }) => { log("full detail"); return { rendered: "done", changedFiles: ["hello.txt"] }; });
    assert.equal(result.digest.status, "passed");
    assert.match(fs.readFileSync(result.digest.logPath, "utf8"), /full detail/);
    const fail = await runTrackedJob(dir, createJobRecord(dir, "task"), async () => { throw new Error("Provider failed"); });
    assert.equal(fail.digest.status, "error");
    assert.deepEqual(fail.digest.failures, ["Provider failed"]);
  } finally {
    if (old === undefined) delete process.env.OPENCODE_COMPANION_DATA; else process.env.OPENCODE_COMPANION_DATA = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
