// Process utilities for the OpenCode companion.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const IS_WINDOWS = process.platform === "win32";

// Never execute npm shims with cmd.exe: cmd expands %, &, | and quotes.
// Resolve only recognized npm launcher targets; reject arbitrary batch files.
export function resolveInvocation(cmd, args = [], opts = {}) {
  if (!IS_WINDOWS) return { command: cmd, args };
  let executable = cmd;
  if (!path.isAbsolute(cmd)) {
    const found = spawnSync("where.exe", [cmd], { encoding: "utf8", env: opts.env ?? process.env });
    const candidates = (found.stdout || "").trim().split(/\r?\n/).filter(Boolean);
    executable = candidates.find((p) => /\.exe$/i.test(p))
      ?? candidates.find((p) => /\.cmd$/i.test(p)) ?? cmd;
  }
  if (/\.(cmd|bat)$/i.test(executable)) {
    const source = fs.readFileSync(executable, "utf8");
    const target = source.match(/"%dp0%[\\/]([^"\r\n]+\.(?:exe|[cm]?js))"/i)
      ?? source.match(/"%~dp0[\\/]([^"\r\n]+\.(?:exe|[cm]?js))"/i);
    if (!target) throw new Error(`Unsupported Windows launcher: ${executable}; configure a native executable`);
    const file = path.resolve(path.dirname(executable), target[1]);
    if (!fs.existsSync(file)) throw new Error(`Windows launcher target missing: ${file}`);
    return /\.exe$/i.test(file) ? { command: file, args } : { command: process.execPath, args: [file, ...args] };
  }
  return { command: executable, args };
}

export function spawnCommand(cmd, args, opts = {}) {
  const env = { ...process.env, ...opts.env };
  const invocation = resolveInvocation(cmd, args, { env });
  return spawn(invocation.command, invocation.args, { ...opts, env, shell: false, windowsHide: true });
}

export function runCommandSync(cmd, args, opts = {}) {
  const invocation = resolveInvocation(cmd, args, opts);
  return spawnSync(invocation.command, invocation.args, { ...opts, shell: false, windowsHide: true });
}

/**
 * Resolve the full path to the `opencode` binary.
 * @returns {Promise<string|null>}
 */
export async function resolveOpencodeBinary() {
  return new Promise((resolve) => {
    // `which` isn't a native Windows binary; `where` is the equivalent.
    const proc = spawn(IS_WINDOWS ? "where" : "which", ["opencode"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", (code) => resolve(code === 0 ? out.trim().split(/\r?\n/)[0] : null));
    proc.on("error", () => resolve(null));
  });
}

/**
 * Check if `opencode` CLI is available.
 * @returns {Promise<boolean>}
 */
export async function isOpencodeInstalled() {
  const bin = await resolveOpencodeBinary();
  return bin !== null;
}

/**
 * Get the installed opencode version.
 * @returns {Promise<string|null>}
 */
export async function getOpencodeVersion() {
  return new Promise((resolve) => {
    // Windows npm shims are .cmd/.ps1; spawn() only resolves those via a shell.
    const proc = spawnCommand("opencode", ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", (code) => resolve(code === 0 ? out.trim() : null));
    proc.on("error", () => resolve(null));
  });
}

/**
 * Run a command and return { stdout, stderr, exitCode }.
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [opts]
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
export function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let proc;
    try { proc = spawnCommand(cmd, args, {
      stdio: [opts.input == null ? "ignore" : "pipe", "pipe", "pipe"],
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    }); } catch (err) { resolve({ stdout: "", stderr: String(err), exitCode: 1 }); return; }
    if (opts.input != null) { proc.stdin.on("error", () => {}); proc.stdin.end(opts.input); }
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.stdout.on("data", (d) => opts.onOutput?.(d.toString(), "stdout"));
    proc.stderr.on("data", (d) => opts.onOutput?.(d.toString(), "stderr"));
    proc.on("close", (exitCode) => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
    proc.on("error", (err) => resolve({ stdout: "", stderr: String(err), exitCode: 1 }));
  });
}

/**
 * Spawn a detached background process.
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} opts
 * @returns {import("node:child_process").ChildProcess}
 */
export function spawnDetached(cmd, args, opts = {}) {
  const logFd = opts.logFile ? fs.openSync(opts.logFile, "a") : null;
  let child;
  try {
    child = spawnCommand(cmd, args, {
      stdio: logFd === null ? "ignore" : ["ignore", logFd, logFd],
      detached: true,
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
    });
  } finally {
    if (logFd !== null) fs.closeSync(logFd);
  }
  child.unref();
  return child;
}
