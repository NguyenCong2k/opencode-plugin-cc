export function collectTelemetry(value) {
  const commands = [], failures = [], tests = [];
  const seen = new Set();
  let blocked = false;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    const state = node.state ?? node;
    const command = state.input?.command ?? node.input?.command;
    const tool = node.tool ?? node.name ?? node.type;
    if (typeof command === "string" && /bash|shell|tool/.test(tool || "")) {
      const code = state.metadata?.exit ?? state.metadata?.exitCode ?? state.exitCode ?? node.exitCode;
      const exitCode = Number.isInteger(code) ? code : state.status === "error" ? 1 : null;
      const key = node.id ?? `${command}:${exitCode}`;
      if (!seen.has(key)) {
        seen.add(key); commands.push({ command, exitCode });
        if (/\b(test|pytest|vitest|jest|ctest|dotnet test)\b/.test(command)) tests.push({ command, exitCode });
      }
    }
    const error = state.error ?? (node.type === "error" ? node.error ?? node.message : null);
    if (error) {
      const text = typeof error === "string" ? error : error.message ?? JSON.stringify(error);
      failures.push(...text.split(/\r?\n/));
      if (/permission|denied|approval|confirm|policy|interactive/i.test(text)) blocked = true;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "input" || key === "metadata") continue;
      if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === "object") visit(child);
    }
  }
  if (typeof value === "string") {
    for (const line of value.split(/\r?\n/)) { try { visit(JSON.parse(line)); } catch {} }
  } else visit(value);
  return { commands, failures: failures.slice(0, 40), tests, blocked };
}

export function makeDigest({ result = {}, error, commands = [], logPath, worktreePath, configChanges = [] }) {
  const telemetry = collectTelemetry(result.messages ?? result.raw ?? "");
  const failures = [...telemetry.failures, ...(error ? String(error.message ?? error).split(/\r?\n/) : [])].slice(0, 40);
  const blocked = telemetry.blocked || /permission|denied|approval|confirm|blocked|interactive/i.test(error?.message ?? "");
  const failedCommand = telemetry.commands.some((c) => c.exitCode !== null && c.exitCode !== 0);
  return {
    status: blocked ? "blocked" : error ? "error" : failures.length || failedCommand ? "failed" : "passed",
    filesChanged: result.changedFiles ?? [],
    commandsRun: [...commands, ...telemetry.commands],
    testsSummary: result.testsSummary ?? { observed: telemetry.tests.length, passed: telemetry.tests.filter((t) => t.exitCode === 0).length,
      failed: telemetry.tests.filter((t) => t.exitCode !== null && t.exitCode !== 0).length,
      unknown: telemetry.tests.filter((t) => t.exitCode === null).length },
    failures, logPath, worktreePath: worktreePath ?? null, configChanges,
  };
}
