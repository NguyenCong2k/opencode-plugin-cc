// Job lifecycle tracking and progress reporting for the OpenCode companion.

import fs from "node:fs";
import path from "node:path";
import { ensureDir, appendLine } from "./fs.mjs";
import { generateJobId, upsertJob, jobLogPath, jobDataPath, loadState } from "./state.mjs";
import { commandContext } from "./process.mjs";
import { makeDigest, collectTelemetry } from "./digest.mjs";
import { incident, failureType } from "./incidents.mjs";

const SESSION_ID_ENV = "OPENCODE_COMPANION_SESSION_ID";

/**
 * Get the current Claude session ID from environment.
 * @returns {string|undefined}
 */
export function getClaudeSessionId() {
  return process.env[SESSION_ID_ENV] || process.env.CLAUDE_SESSION_ID;
}

/**
 * Create a new job record.
 * @param {string} workspacePath
 * @param {string} type - "review" | "adversarial-review" | "task"
 * @param {object} [meta] - additional metadata
 * @returns {object} the created job
 */
export function createJobRecord(workspacePath, type, meta = {}) {
  const id = generateJobId(type);
  const sessionId = getClaudeSessionId();
  const job = {
    id,
    type,
    status: "pending",
    sessionId,
    ...meta,
  };
  upsertJob(workspacePath, job);
  return job;
}

/**
 * Run a tracked job with full lifecycle management.
 * @param {string} workspacePath
 * @param {object} job
 * @param {(ctx: { report: Function, log: Function }) => Promise<object>} runner
 * @returns {Promise<object>} the job result
 */
export async function runTrackedJob(workspacePath, job, runner) {
  job = { ...loadState(workspacePath).jobs?.find((j) => j.id === job.id), ...job };
  const commands = [];
  // Mark as running
  upsertJob(workspacePath, { id: job.id, status: "running", pid: process.pid });

  const logFile = jobLogPath(workspacePath, job.id);
  ensureDir(path.dirname(logFile));

  const report = (phase, message) => {
    const line = `[${new Date().toISOString()}] [${phase}] ${message}`;
    appendLine(logFile, line);
    upsertJob(workspacePath, { id: job.id, phase, lastOutputAt: new Date().toISOString() });
  };

  const log = (message) => {
    appendLine(logFile, `[${new Date().toISOString()}] ${message}`);
    upsertJob(workspacePath, { id: job.id, lastOutputAt: new Date().toISOString() });
  };

  try {
    report("starting", `Job ${job.id} started`);
    const result = await commandContext.run({ commands, incidentLog: job.incidentLog, log }, () => runner({ report, log }));
    log(JSON.stringify(result));
    const current = loadState(workspacePath).jobs.find((j) => j.id === job.id);
    const digest = makeDigest({ result, commands, logPath: logFile, worktreePath: current?.worktreePath, configChanges: current?.configChanges });
    const payload = { ...result, digest };
    for (const command of collectTelemetry(result.messages ?? result.raw).commands) {
      if (command.exitCode !== null && command.exitCode !== 0) incident(job.incidentLog, "command_failed", command.command, digest.failures.join("\n") || `Exit code ${command.exitCode}`, "Agent command failed; retained in digest");
    }
    for (const failure of digest.failures) incident(job.incidentLog, failureType(failure), job.id, failure, "Recorded in final digest");

    // Mark as completed
    upsertJob(workspacePath, {
      id: job.id,
      status: digest.status === "passed" ? "completed" : "failed",
      completedAt: new Date().toISOString(),
      result: JSON.stringify(digest), digest,
    });

    // Write result data file
    const dataFile = jobDataPath(workspacePath, job.id);
    ensureDir(path.dirname(dataFile));
    fs.writeFileSync(dataFile, JSON.stringify(payload, null, 2), "utf8");

    report("completed", `Job ${job.id} completed`);
    return payload;
  } catch (err) {
    const current = loadState(workspacePath).jobs.find((j) => j.id === job.id);
    const digest = makeDigest({ error: err, commands, logPath: logFile, worktreePath: current?.worktreePath, configChanges: current?.configChanges });
    incident(job.incidentLog, failureType(err.message), job.id, err.message, "Job stopped; see full log");
    fs.writeFileSync(jobDataPath(workspacePath, job.id), JSON.stringify({ digest }), "utf8");
    upsertJob(workspacePath, {
      id: job.id,
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: err.message,
      digest,
    });
    report("failed", `Job ${job.id} failed: ${err.message}`);
    return { digest };
  }
}

/**
 * Create a progress reporter for a job.
 * @param {string} workspacePath
 * @param {string} jobId
 * @returns {{ report: Function, log: Function }}
 */
export function createProgressReporter(workspacePath, jobId) {
  const logFile = jobLogPath(workspacePath, jobId);

  return {
    report(phase, message) {
      const line = `[${new Date().toISOString()}] [${phase}] ${message}`;
      appendLine(logFile, line);
      upsertJob(workspacePath, { id: jobId, phase });
    },
    log(message) {
      appendLine(logFile, `[${new Date().toISOString()}] ${message}`);
    },
  };
}
