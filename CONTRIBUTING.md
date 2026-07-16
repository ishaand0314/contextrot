# Contributing

## Local setup

```
npm install
npm run build
npm test
```

`npm run build` compiles TypeScript with `tsc`. `npm test` runs the test suite with vitest. Both must pass before you open a pull request.

To try your changes against the CLI without publishing:

```
npm run build
node bin/contextrot.js --demo
```

## Before opening a pull request

- Run `npm run build` and `npm test` locally and confirm both succeed.
- Add or update tests for any new or changed behavior.
- Update the README if you changed a CLI flag, a library export, or a rot category's detection logic.
- Keep pull requests focused on one change. Separate unrelated fixes into separate PRs.
- Describe what changed and why in the PR description. The PR template includes a checklist; fill it in.

## Code style

- Follow the existing code style in the file you're editing.
- Keep functions small and documented with a short comment explaining intent, matching the existing source.
- No em dashes in comments, docs, or CLI output. Use a comma, colon, or period instead.

## Reporting bugs

Open an issue with the transcript shape that triggered the problem (redact anything sensitive first), the command you ran, and what you expected versus what happened.

For security vulnerabilities, see [SECURITY.md](./SECURITY.md) instead of opening a public issue.
