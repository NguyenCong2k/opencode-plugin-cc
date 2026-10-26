import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "../plugins/opencode/scripts/lib/process.mjs";

describe("process", () => {
  it("roundtrips shell metacharacters and Vietnamese without a shell", async () => {
    const input = 'a "b" & c | d % é tiếng Việt';
    const result = await runCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", input]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, input);
    assert.doesNotMatch(result.stderr, /DEP0190/);
  });

  it("passes prompt through stdin exactly", async () => {
    const input = 'a "b" & c | d % é tiếng Việt\n$(touch unsafe)';
    const result = await runCommand(process.execPath, ["-e", "process.stdin.pipe(process.stdout)"], { input });
    assert.equal(result.stdout, input);
  });
  it("runCommand captures stdout", async () => {
    const { stdout, exitCode } = await runCommand("echo", ["hello"]);
    assert.equal(stdout.trim(), "hello");
    assert.equal(exitCode, 0);
  });

  it("runCommand captures exit code on failure", async () => {
    const { exitCode } = await runCommand("false", []);
    assert.notEqual(exitCode, 0);
  });

  it("runCommand captures stderr", async () => {
    const { stderr, exitCode } = await runCommand(process.execPath, ["--definitely-invalid-node-option"]);
    assert.notEqual(exitCode, 0);
    assert.ok(stderr.trim().length > 0);
  });
});
