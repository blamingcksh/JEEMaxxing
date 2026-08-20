---
name: rigorous-verification
description: Verification-first workflow for engineering changes. Offload deterministic work to real tools instead of approximating in-head, and run syntax/behavior checks before reporting any change complete. Use for non-trivial edits, bug fixes, and refactors.
---

# Rigorous Verification Workflow

Apply this workflow to any non-trivial code change: bug fixes, feature work,
refactors, and edits that touch more than a trivial constant or string.

## 1. Offload deterministic work — never approximate

For any of the following, use a real tool instead of reasoning the answer out
in-head:

- **Arithmetic / derived values** — compute via `run_terminal_command` (e.g.
  `node -e "..."`) rather than mental math.
- **Regex and pattern matching** — test against the real tooling
  (`code_search` / ripgrep), never hand-simulate.
- **File-tree / dependency questions** — use `glob`, `list_directory`, and
  `code_search` to locate files and references; don't guess.
- **Runtime state and live behavior** — check with `node --check` and the
  project's scripts (below), not memory.

If the exact value or behavior is in doubt, stop and run the tool. Never emit
an "I think it's X" where X is deterministic and checkable.

## 2. Verify every change before reporting done

Do not report a task complete until each edited file has passed its checks and
the output has been read.

1. **Syntax-check** every edited JS file:
   - `node --check path/to/file.js`
   - `node --check path/to/file.mjs` (works for ES modules too)
2. **Run behavior checks** for this project:
   - `npm run smoke` — fast smoke tests (answer resolution, pomo config,
     boot sequence, practice nav)
   - `npm run qa` — boot-sequence QA
   - `npm run qa-analysis` / `npm run qa-stale` — analysis-tab checks, when
     the change touches `analysis.js` or related UI
3. **Read the output.** A command that returns exit 0 with no output still
   counts as success, but always inspect failures before moving on.

## 3. Completion gate

- If any check fails, read the failure, fix the cause, and re-run — do not
  paper over it.
- Only report "done" after the relevant checks pass.
- If a check cannot be run (missing script, environment), say so explicitly
  rather than implying verification happened.

## 4. Scope discipline

- Match existing conventions; don't introduce libraries that aren't already
  in `package.json`.
- Prefer editing existing files; make the fewest changes that satisfy the
  request.
