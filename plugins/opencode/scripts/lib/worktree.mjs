import path from "node:path";
import fs from "node:fs";
import { runCommand } from "./process.mjs";
import { stateRoot } from "./state.mjs";

export async function createWorktree(workspace, branch, jobId) {
  const valid = await runCommand("git", ["check-ref-format", "--branch", branch], { cwd: workspace });
  if (valid.exitCode !== 0 || branch.startsWith("-")) throw new Error(`Invalid worktree branch: ${branch}`);
  const target = path.join(stateRoot(workspace), "worktrees", jobId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const existing = await runCommand("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: workspace });
  const args = ["worktree", "add", ...(existing.exitCode === 0 ? [] : ["-b", branch]), target, ...(existing.exitCode === 0 ? [branch] : ["HEAD"])];
  const result = await runCommand("git", args, { cwd: workspace });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  return { path: target, branch, command: { command: `git ${args.join(" ")}`, exitCode: result.exitCode } };
}
