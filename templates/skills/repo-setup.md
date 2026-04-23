# Skill: repo-setup

Generate a complete, autonomous Claude Code configuration for a specific repo so it can be worked on independently without the workspace root. Use when transitioning from multi-repo workspace mode to atomic per-repo development.

## When to invoke

- You want to work on a single repo in isolation (its own Claude Code session).
- The repo doesn't have a `CLAUDE.md` or `.claude/` directory yet.
- The repo's `CLAUDE.md` is outdated and needs a full refresh.

## Protocol

1. **Read the repo.** Scan the directory structure, `package.json` / `pyproject.toml`, existing docs, and any partial `CLAUDE.md`.
2. **Identify the stack.** Detect framework, language version, test runner, linter, DB, etc.
3. **Generate `CLAUDE.md`.** Must include:
   - What the repo does (1 paragraph).
   - Stack (exact versions if detectable).
   - How to run locally (commands).
   - How to run tests.
   - Key architectural decisions and gotchas.
   - Conventions (naming, file structure, import style).
   - Communication with other services (if any).
4. **Generate `.claude/rules/`** with the applicable rule files for the detected stack.
5. **Generate `.claude/skills/`** with at least: `session-start.md`, `progress-tracker.md`, `code-review.md`.
6. **Commit everything** with `chore(setup): add Claude Code autonomous config`.

## Output files

```
<repo>/
├── CLAUDE.md                      ← main context file
└── .claude/
    ├── rules/
    │   ├── tests.md
    │   ├── commits.md
    │   ├── branching.md
    │   └── <stack>.md             ← typescript.md / python-django.md / etc.
    └── skills/
        ├── session-start.md
        ├── progress-tracker.md
        └── code-review.md
```

## Quality bar for CLAUDE.md

A good `CLAUDE.md` allows Claude to:
- Start a session and immediately know what the repo does.
- Run the app and tests without asking for instructions.
- Understand which patterns to follow and which to avoid.
- Know how this repo communicates with other services.

If any of the above is unclear after reading `CLAUDE.md`, the file is incomplete.
