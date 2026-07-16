# Security

## Reporting a vulnerability

If you find a security vulnerability in contextrot, do not open a public GitHub issue.

Report it privately by emailing the maintainer at the address listed on the [npm package page](https://www.npmjs.com/package/contextrot) or via a private security advisory on the [GitHub repository](https://github.com/ishaand0314/contextrot). Include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce it, including a minimal transcript or input if relevant.
- Any suggested fix, if you have one.

We will acknowledge your report and follow up with next steps once the issue has been reviewed.

## Scope

contextrot is a local, offline command-line tool and library. It reads a transcript file from disk (or the bundled demo data) and writes a report to stdout. It does not make network requests, does not send transcript data anywhere, and does not execute code contained in the transcripts it analyzes.
