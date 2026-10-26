import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import { runCommand } from "./process.mjs";

export async function createWorktree(workspace, branch, jobId) {
  const valid = await runCommand("git", ["check-ref-format", "--branch", branch], { cwd: workspace });
  if (valid.exitCode !== 0 || branch.startsWith("-")) throw new Error(`Invalid worktree branch: ${branch}`);
  // Deep plugin cache/data paths can exceed Git for Windows' GIT_DIR limit.
  const key = crypto.createHash("sha256").update(workspace).digest("hex").slice(0, 16);
  const target = path.join(process.env.OPENCODE_WORKTREE_ROOT ?? path.join(os.tmpdir(), "opencode-worktrees"), key, jobId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = await runCommand("git", ["for-each-ref", "--format=%(refname)", `refs/heads/${branch}`], { cwd: workspace });
  if (existing.exitCode !== 0) throw new Error(existing.stderr);
  const branchExists = existing.stdout.split(/\r?\n/).includes(`refs/heads/${branch}`);
  const args = ["-c", "core.longpaths=true", "worktree", "add", ...(branchExists ? [] : ["-b", branch]), target, ...(branchExists ? [branch] : ["HEAD"])];
  const result = await runCommand("git", args, { cwd: workspace });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  return { path: target, branch, command: { command: `git ${args.join(" ")}`, exitCode: result.exitCode } };
}
