# Repository checks

Most tests call one module with small inputs. A second group reads the repository itself and fails when its parts drift
apart: a link breaks, a page loses its landmark, a migration loses its rollback. They run in milliseconds, never change
anything and need no stand-ins. All are part of `npm test`.

| test | what it keeps true |
|---|---|
| `tests/repo-layout-test.mjs` | migration files are `<14 digits>_<snake_case>.sql`, unique and in order; every function named in `vercel.json` has an `api/` file; the security headers are present; every page and clean route listed in `vite.config.js` exists |
| `tests/migration-rollbacks-test.mjs` | every migration from `20261012100000` on has a `.down.sql` in `supabase/proposed/rollback/`, a migration that names its rollback names the right file, and no rollback is an orphan |
| `tests/imports-resolve-test.mjs` | every relative import in `src/`, `server/` and `api/` points at a file that exists, and server code never imports browser-only folders (pages, mascot, electric, library, home, workers) |
| `tests/html-pages-test.mjs` | each page has a doctype, `lang="en"`, a mobile viewport, one title, a `<main>`, a heading, an existing module script and no inline `onclick`-style attributes |
| `tests/footer-links-test.mjs` | footer and brand links lead to pages the build serves |
| `tests/docs-links-test.mjs` | relative links in `docs/` resolve; source paths named in the top-level docs exist |
| `tests/module-docs-links-test.mjs` | module guides are linked from `docs/modules/README.md` and name only files that exist |
| `tests/env-docs-test.mjs` | `docs/ENVIRONMENT-VARIABLES.md` lists every variable the code reads and no variable it has stopped reading |
| `tests/test-script-wiring-test.mjs` | every test file is wired into the `test` script in `package.json` |
| `tests/seo-test.mjs` | sitemap, canonical URLs, `noindex` on private pages and prices in the structured data match the migrations |

## When one fails
- **A moved or renamed file** is the usual cause: fix the link, import or doc reference, not the check.
- **A new page** must be added to `vite.config.js` (`pages` and, for a clean URL, `cleanRoutes`) and to the sitemap if it is public.
- **A new environment variable** must be added to `docs/ENVIRONMENT-VARIABLES.md` in the same change.
- **A new migration** from the AI-limits migration on needs its `.down.sql`, written the same day as the migration.
- **A new test file** must be added to the end of the `test` script in `package.json`.

Known oddity the layout check tolerates: `20261017300000_yearly_billing` has an hour part of 30. See
[../DATABASE-MIGRATIONS.md](../DATABASE-MIGRATIONS.md).
