# Git Commit Rules

## Conventional Commits

Every commit message follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary>

<optional body>

<optional footer>
```

- `type` is one of: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`,
  `style`, `perf`, `build`, `ci` (matches root `CLAUDE.md`).
- `scope` is the affected area when it adds clarity: `api`, `web`, `prisma`,
  a module name (`auth`, `orders`, `billing`), etc. Omit it when the change
  is repo-wide or the scope is obvious.
- Summary: imperative mood ("add", not "added"/"adds"), lowercase after the
  colon, no trailing period, under ~72 characters.
- Body (optional): explain *why*, not *what* — the diff already shows what
  changed. Wrap at ~72 characters.
- Breaking change: add `!` after the type/scope (`feat(api)!: ...`) and/or a
  `BREAKING CHANGE:` footer explaining the migration.

## Examples

```
feat(orders): add coupon validation on checkout
fix(api): return 404 instead of 500 for unknown organization id
test(auth): cover expired-token rejection on refresh endpoint
docs: document DATABASE_URL setup in README
refactor(web): extract cart hook out of checkout page
chore: bump prisma to 7.9.1
```

## Commit Hygiene

- One logical change per commit — don't bundle an unrelated refactor with a
  feature commit.
- Small, focused diffs (root `CLAUDE.md`) — prefer several small commits
  over one large one when the change has distinct logical steps.
- Never commit build artifacts (`.next/`, `dist/`, `coverage/`),
  `node_modules`, or `.env` (only `.env.example` is tracked).
- Only commit when explicitly asked to; never `--amend` a commit unless
  explicitly requested, and never skip hooks (`--no-verify`) without
  explicit instruction.
