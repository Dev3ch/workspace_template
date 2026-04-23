# Skill: security-review

Complete a security review of pending changes on the current branch. Checks for OWASP Top 10 issues, secrets in code, authentication/authorization gaps, and injection vulnerabilities.

## When to invoke

- Before merging a PR that touches authentication, payments, file uploads, or external integrations.
- When a new endpoint is added that handles sensitive data.
- Periodically on the main branch to catch regressions.

## Checklist

### Secrets & credentials
- [ ] No hardcoded API keys, tokens, passwords, or private keys in source code.
- [ ] No secrets in git history (check with `git log -p | grep -E 'key|token|secret|password'`).
- [ ] `.env` files are in `.gitignore`.

### Authentication & authorization
- [ ] Every endpoint that mutates state requires authentication.
- [ ] Authorization checks verify the user owns the resource (no IDOR).
- [ ] Multi-tenant: every query filters by `organization_id` — no cross-tenant data leaks.
- [ ] JWT tokens have expiration and are validated server-side.
- [ ] Sensitive endpoints enforce rate limiting.

### Injection
- [ ] No raw SQL — use ORM or parameterized queries.
- [ ] User input is never interpolated directly into shell commands.
- [ ] File uploads validate type and size; filenames are sanitized.
- [ ] HTML output is escaped (no XSS via template injection).

### OWASP Top 10 (abridged)
- [ ] A01 Broken Access Control — checked above.
- [ ] A02 Cryptographic Failures — passwords hashed with bcrypt/argon2; PII encrypted at rest.
- [ ] A03 Injection — checked above.
- [ ] A05 Security Misconfiguration — DEBUG=False in production; no default credentials.
- [ ] A07 Auth Failures — session tokens invalidated on logout; no predictable IDs.
- [ ] A09 Logging — sensitive data (passwords, tokens) not logged.

### Dependencies
- [ ] No known critical CVEs in dependencies (`npm audit` / `pip-audit` / `uv pip check`).

## Output

For each finding:
- **Severity**: Critical / High / Medium / Low / Info
- **Location**: file + line
- **Description**: what the issue is
- **Recommendation**: how to fix it

End with a summary: pass / fail / needs-attention.
