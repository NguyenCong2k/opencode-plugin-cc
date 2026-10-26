import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCommand } from "../plugins/opencode/scripts/lib/process.mjs";
import { createWorktree } from "../plugins/opencode/scripts/lib/worktree.mjs";

it("creates isolated worktrees in Unicode paths and rejects invalid branches", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree tiếng Việt "));
  const old = process.env.OPENCODE_COMPANION_DATA;
  const oldRoot = process.env.OPENCODE_WORKTREE_ROOT;
  process.env.OPENCODE_WORKTREE_ROOT = path.join(dir, "cây công việc");
  process.env.OPENCODE_COMPANION_DATA = path.join(dir, "dữ liệu");
  try {
    await runCommand("git", ["init", dir]);
    await runCommand("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"], { cwd: dir });
    const result = await createWorktree(dir, "job-one", "one");
    assert.equal(result.command.exitCode, 0);
    fs.writeFileSync(path.join(result.path, "hello.txt"), "hello");
    assert.equal(fs.existsSync(path.join(dir, "hello.txt")), false);
    const second = await createWorktree(dir, "job-two", "two");
    assert.notEqual(result.path, second.path);
    await assert.rejects(createWorktree(dir, "--bad", "bad"), /Invalid worktree branch/);
  } finally {
    if (old === undefined) delete process.env.OPENCODE_COMPANION_DATA; else process.env.OPENCODE_COMPANION_DATA = old;
    if (oldRoot === undefined) delete process.env.OPENCODE_WORKTREE_ROOT; else process.env.OPENCODE_WORKTREE_ROOT = oldRoot;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
