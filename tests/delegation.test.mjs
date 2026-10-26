import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../plugins/opencode/scripts/lib/process.mjs";

const companion = fileURLToPath(new URL("../plugins/opencode/scripts/opencode-companion.mjs", import.meta.url));
const fixture = `import fs from 'node:fs';
const args=process.argv.slice(2);
if(args[0]==='--version') console.log('opencode v2.1.4');
else if(args.includes('--help')) console.log('--auto --standalone');
else if(args[0]==='debug') console.log(JSON.stringify(args[1]==='config'?[]:[{id:'build',permissions:[]},{id:'plan',permissions:[]}]));
else if(args[0]==='auth') console.log('Default stored credentials');
else if(args[0]==='models') console.log('opencode-go/flash\\nopencode/flash');
else if(args[0]==='run') {
 let input=''; for await(const chunk of process.stdin) input+=chunk;
 if(process.env.CAPTURE) fs.writeFileSync(process.env.CAPTURE,JSON.stringify({args,input,cwd:process.cwd(),pwd:process.env.PWD}));
 if(process.env.SLOW_JOB) await new Promise(()=>setInterval(()=>{},1000));
 if(process.env.FAIL_PROVIDER) { console.log(JSON.stringify({type:'error',error:{message:'Policy budget exceeded'}})); process.exit(1); }
 fs.writeFileSync('hello.txt','hello');
 console.log(JSON.stringify({type:'tool_use',sessionID:'ses_fake',part:{id:'part1',type:'tool',tool:'shell',state:{status:'completed',input:{command:'git status'},metadata:{exit:0},output:'?? hello.txt'}}}));
 console.log(JSON.stringify({type:'text',part:{type:'text',text:'done'}}));
}
`;

it("background CLI jobs preserve model variant and stdin, isolate worktrees, expose cheap status and JSON results", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ủy quyền tiếng Việt "));
  const bin = path.join(dir, "bin"), repo = path.join(dir, "repo có dấu"), data = path.join(dir, "state");
  fs.mkdirSync(bin); fs.mkdirSync(repo);
  fs.writeFileSync(path.join(bin, "fake.mjs"), fixture);
  fs.writeFileSync(path.join(bin, "opencode.cmd"), '@echo off\r\n"%dp0%\\fake.mjs" %*\r\n');
  fs.writeFileSync(path.join(bin, "opencode"), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${path.join(bin, "fake.mjs").replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, OPENCODE_COMPANION_DATA: data, OPENCODE_WORKTREE_ROOT: path.join(dir, "worktrees"), CAPTURE: path.join(dir, "capture.json") };
  const call = (args, opts = {}) => runCommand(process.execPath, [companion, ...args], { cwd: repo, env, ...opts });
  try {
    await runCommand("git", ["init", repo]);
    await runCommand("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "initial"], { cwd: repo });
    const setup = await call(["setup", "--json"]);
    assert.equal(setup.exitCode, 0, setup.stderr);
    assert.deepEqual(JSON.parse(setup.stdout).providers, ["opencode-go", "opencode"]);
    const prompt = 'a "b" & c | d % é tiếng Việt';
    const start = await call(["task", "--arguments-stdin"], { input: JSON.stringify(["--background", "--full-access", "--model", "opencode-go/flash#max", "--worktree", "test-job", "--incident-log", path.join(dir,"incidents.md"), prompt]) });
    assert.equal(start.exitCode, 0, start.stderr);
    const jobId = JSON.parse(start.stdout).jobId;
    let status;
    for(let i=0;i<100;i++) {
      const result = await call(["status", jobId, "--json"]);
      status = JSON.parse(result.stdout).job;
      assert.ok(result.stdout.length < 500);
      assert.equal(status.progressPreview, undefined);
      if(status.status !== 'running') break;
      await new Promise((resolve)=>setTimeout(resolve,100));
    }
    assert.equal(status.status, "done", (await call(["result", jobId])).stdout);
    assert.ok(status.pid > 0); assert.ok(status.lastOutputAt);
    const result = await call(["result", jobId]);
    const digest = JSON.parse(result.stdout);
    assert.equal(digest.status, "passed");
    assert.deepEqual(digest.filesChanged, ["hello.txt"]);
    assert.ok(digest.commandsRun.some((c)=>c.command==='git status' && c.exitCode===0));
    assert.equal(fs.existsSync(path.join(repo,"hello.txt")),false);
    assert.equal(fs.readFileSync(path.join(digest.worktreePath,"hello.txt"),"utf8"),'hello');
    const capture = JSON.parse(fs.readFileSync(env.CAPTURE));
    assert.ok(capture.input.includes(prompt));
    assert.ok(capture.args.includes("opencode-go/flash#max"));
    assert.ok(capture.args.includes("--auto"));
    assert.ok(capture.args.includes("--standalone"));
    assert.equal(capture.pwd, capture.cwd);
    assert.equal(capture.args.some((x)=>x.includes(prompt)),false);
    const badModel = await call(["task", "--model", "opencode/missing", "test"]);
    assert.equal(JSON.parse(badModel.stdout).status, "error");
    assert.match(JSON.parse(badModel.stdout).failures.join("\n"), /Model not found/);
    const budget = await call(["task", "--model", "opencode/flash#max", "test"], { env: { ...env, FAIL_PROVIDER: "1" } });
    const failure = JSON.parse(budget.stdout);
    assert.equal(failure.status, "failed");
    assert.match(failure.failures.join("\n"), /Policy budget exceeded/);
    assert.match(failure.failures.join("\n"), /opencode-go\/flash#max/);
    const incidentFile = path.join(dir, "cancel-incidents.md");
    const slowStart = await call(["task", "--background", "--incident-log", incidentFile, "slow"], { env: { ...env, SLOW_JOB: "1" } });
    const slowId = JSON.parse(slowStart.stdout).jobId;
    for (let i = 0; i < 100; i++) {
      const slow = JSON.parse((await call(["status", slowId, "--json"])).stdout).job;
      if (slow.agentPid) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const cancel = await call(["cancel", slowId]);
    assert.equal(JSON.parse(cancel.stdout).status, "failed");
    assert.equal(JSON.parse((await call(["result", slowId])).stdout).status, "failed");
    assert.match(fs.readFileSync(incidentFile, "utf8"), /killed_process/);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 }); }
});
