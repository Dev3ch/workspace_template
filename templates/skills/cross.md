---
name: cross
description: Coordina cambios que afectan múltiples repositorios simultáneamente.
---

# /cross

Plan and execute changes that span multiple repositories. Use when a feature requires modifications to backend AND frontend simultaneously, or when an API contract change affects more than one repo.

## When to invoke

- A feature touches API definitions in one repo and type definitions/clients in another.
- A database model change requires a matching serializer, endpoint, and frontend hook update.
- A breaking change in a satellite service requires updates in the core API and the consuming frontend.

## Protocol

1. **Identify all affected repos.** List every repo that must change for this feature to be complete.
2. **Define the contract boundary.** Agree on the API shape (endpoint, payload, response) before writing code in either repo.
3. **Order the changes.** Usually: backend first (model → serializer → endpoint → tests), then frontend (types → service → hook → component).
4. **One branch per repo.** Create `feat/issue-{N}-description` in each affected repo, all referencing the same parent issue.
5. **One PR per repo.** Open PRs in the correct order — backend PR first so the frontend PR can reference the merged contract.
6. **Verify the contract end-to-end.** After both PRs merge, confirm the integration works (local docker compose up or staging).

## Rules

- Never ship a frontend change that assumes a backend endpoint that hasn't merged yet.
- If the contract changes, update both sides in the same iteration — never leave one side stale.
- Document the contract in the parent issue body before opening any PR.
- Cross-repo changes are tracked under a single GitHub Issue in the primary repo; each sub-repo gets a sub-issue or a linked PR.

## Output

For each repo affected, produce:
- Branch name
- Files changed (with rationale)
- PR title and body referencing the parent issue
- Any migration or deployment notes

## Siguiente paso

- **Contrato definido** → `/apply` en el repo backend primero
- **Backend mergeado** → `/apply` en el frontend con el contrato ya estable
- **Todos los PRs abiertos** → `/review` en cada uno
- **Todo mergeado** → `/secure` + `/deploy` en el orden correcto (backend antes que frontend)
