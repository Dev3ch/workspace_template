---
name: triage
description: Cierra issues cubiertos y mueve estados en bulk.
---

# /triage

Analyze a PR or epic against its issues, update acceptance criteria coverage, close covered issues, and move board statuses in bulk.

## Credenciales de GitHub

```bash
source .claude/scripts/resolve-gh-creds.sh || exit 1
```

Detecta la cuenta con acceso al repo y exporta `GH_TOKEN` y `GITHUB_USER`.

## When to invoke

- After a large PR lands and you need to close the issues it covers.
- To audit an epic and determine which sub-issues are done vs pending.
- To move multiple issues from one board column to another in bulk.
- To clean up a backlog after a sprint or release.

## Protocol

1. **Identify scope.** Is this a PR triage, an epic audit, or a board cleanup?
2. **Fetch the relevant items:**
   - For a PR: `gh pr view <N> --json title,body,commits` + `gh issue list --label <epic-label>`
   - For an epic: list all sub-issues linked to the parent issue.
3. **Match changes to acceptance criteria.** For each sub-issue, check if the merged code satisfies its acceptance criteria.
4. **Close covered issues.** For each issue whose criteria are fully met, close it with a comment referencing the PR: `Closes #N via PR #M`.
5. **Update board statuses.** Move issues to the correct column: Done, In Review, Blocked, etc.
6. **Report gaps.** List any acceptance criteria not yet covered, and which issue tracks them.

## Rules

- Never close an issue unless its acceptance criteria are explicitly covered by merged code.
- If criteria are partially met, add a comment describing what remains and leave the issue open.
- Board moves are permanent — double-check before bulk-moving.
- Always comment on closed issues with the reason (which PR/commit covered it).

## Output

- Summary table: issue | status (closed / partial / open) | covered by
- List of board moves performed
- List of uncovered acceptance criteria with the issue that tracks them

## Siguiente paso

- **Backlog limpio, criterios pendientes identificados** → `/plan` para crear issues de lo que falta
- **Epic completado** → cerrar el epic y celebrar 🎉
- **Hallazgos de drift entre código e issues** → `/sync` para reconciliar
- **Listo para siguiente sprint** → `/init` con el backlog limpio
