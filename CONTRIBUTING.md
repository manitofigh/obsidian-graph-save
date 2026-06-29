# Contributing

Please keep changes lean and easy to review.

## Code

1. Match the style already used in this repo.
2. Keep comments rare. If the code is clear without a comment, skip the comment.
3. Prefer small functions with direct control flow.
4. Look for and reuse existing helpers before adding new ones.

## Git

Commit messages should use:

```text
<short-tag>: <commit-msg>
```

Examples:

```text
fix: restore xyz
docs: simplify xyz
release: update version x.y.z
```

Keep branches short and descriptive:

```text
fix/autosave-interval
docs/readme-install
```

Before opening a pull request, run:

```bash
npm run check
npm run build
```

Thanks!!
