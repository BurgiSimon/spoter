# Contributing to Spoter

Thanks for helping! Bug reports, ideas and pull requests are welcome.

## Development setup

See [README → Local development](README.md#local-development). Before opening a pull request, run:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Integration tests need Postgres: `TEST_DATABASE_URL=postgres://… pnpm test`. CI runs everything.

## Guidelines

- Keep the engine (`src/lib/engine`) free of I/O and covered by tests.
- Database changes: edit `src/lib/db/schema.ts`, then `pnpm db:generate --name <change>`, and
  commit the generated SQL.
- Respect provider rate limits and terms. New providers go through `src/lib/providers/http.ts`
  (rate limiter + retries) and `cached()`.
- Never log tokens, passwords or raw export files.

## Licensing of contributions

Spoter is licensed under the [GNU AGPL-3.0](LICENSE). By submitting a contribution you confirm
that you wrote it (or have the right to submit it) and agree that it is licensed under the
AGPL-3.0. You also grant the project maintainer a perpetual, worldwide, non-exclusive, royalty-free
license to use, modify and relicense your contribution, for example to offer Spoter under
additional licenses. You keep the copyright to your work.

Please sign off your commits (`git commit -s`) to certify the
[Developer Certificate of Origin](https://developercertificate.org/).
