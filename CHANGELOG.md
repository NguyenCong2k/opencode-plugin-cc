# Changelog

## 1.3.0 ? 2026-10-27

- Resolve Windows npm launchers without a shell and preserve Unicode PATH/PWD.
- Discover configured/managed service ports and fall back to CLI auth/models.
- Support OpenCode 1 and 2, including v2 service and private standalone runs.
- Validate provider/model#variant before inference and retain provider errors.
- Add explicit full-access choices with capability/policy preflight checks.
- Back up legacy permission repairs, report changes, and support opt-out.
- Save compact JSON digests and full logs for foreground/background jobs.
- Add cheap local status, isolated worktrees, concurrent state locking and
  incident logging for failures, blocked requests, timeouts and process kills.
- Transport slash arguments/prompts through stdin/files and update forwarding
  skills/hooks to follow the digest contract.

## 1.2.0

- Existing OpenCode companion, review, rescue, state and API compatibility.
