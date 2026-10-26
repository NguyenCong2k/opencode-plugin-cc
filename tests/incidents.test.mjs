import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { incident } from "../plugins/opencode/scripts/lib/incidents.mjs";
import { runCommand, commandContext } from "../plugins/opencode/scripts/lib/process.mjs";

it("appends incidents for blocked requests, failed commands, timeouts and process kills", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "incident tiếng Việt "));
  const file = path.join(dir, "log.md");
  try {
    incident(file, "blocked", "shell request", "Permission denied", "Stop job");
    const commands = [];
    await commandContext.run({ commands, incidentLog: file }, async () => {
      await runCommand(process.execPath, ["-e", "process.stderr.write('original error'); process.exit(7)"]);
      const result = await runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 100 });
      assert.equal(result.exitCode, 124);
    });
    assert.deepEqual(commands.map((c) => c.exitCode), [7, 124]);
    const text = fs.readFileSync(file, "utf8");
    for (const value of ["blocked", "command_failed", "timeout", "killed_process", "original error", "Permission denied"]) assert.ok(text.includes(value), value);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
