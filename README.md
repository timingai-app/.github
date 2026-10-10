# timingai-app/.github

Org-wide defaults for every Timing repo: the pull request templates and the PR lint check.

## Pull requests

Every PR gets a **PR lint** check. It reads the title, the description and the list of changed files, and keeps one comment on the PR listing what's missing. Edit the title or description and it re-checks on its own. Right now it's **soft**: the comment is a to-do list, it doesn't block merging.

### Title

```
type(scope): description
type(scope)!: description      ← ! = breaking change (API contract, DB shape, client must update)
```

- `scope` is optional: the module or area — `chat`, `seo`, `chatbotV2`, `db`.
- Description in English or Chinese, whole title under 100 characters.
- Ticket numbers go in `## Related`, not in the title. Task codes like `T20c` go at the end: `feat(chatbot-v3): card cancel (T20c)`.

| type | when |
|---|---|
| `feat` | new user-facing capability |
| `fix` | corrects a bug |
| `perf` | faster or cheaper, same behavior |
| `refactor` | restructure, same behavior |
| `tune` | prompt / parameter / threshold change — output changes, code paths don't |
| `docs` | docs or comments only |
| `test` | tests only |
| `chore` | deps, config, cleanup |
| `ci` | CI / build / tooling |
| `revert` | reverts an earlier PR |
| `release` | version branch → `main` (ships to prod) |
| `hotfix` | urgent fix straight to `main` |
| `sync` | merge between long-lived branches |

### Description sections

Use these `##` headings (the default template has them all; delete the ones your type doesn't need):

`## Why` · `## What changed` · `## How verified` · `## Related` · `## Screenshots` · `## Deploy notes` · `## Rollback` — plus `## Release check` (release) and `## Forward-port` (hotfix).

✅ required · ○ optional · — not used

| type | Why | What changed | How verified | Related | Deploy notes | Rollback | extra |
|---|---|---|---|---|---|---|---|
| feat | ✅ | ✅ | ✅ | ✅ (`None — reason` ok) | ○ | ○ | |
| fix | ✅ | ✅ | ✅ | ✅ (`None` ok) | ○ | ○ | |
| perf · refactor | ✅ | ✅ | ✅ | ○ | ○ | ○ | |
| tune | ✅ | ✅ | ✅ with **Before / After** | ○ | ○ | ○ | |
| docs · test · chore · ci | ○ | ✅ | ○ | ○ | ○ | ○ | |
| revert | ✅ | ○ | ○ | ✅ the reverted PR | ○ | — | |
| release | — | ✅ PRs included | ✅ | — | ✅ | ✅ | `## Release check`; base must be `main` |
| hotfix | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `## Forward-port`; base must be `main` |
| sync | — | ✅ from → to | ○ | — | — | — | |

`None` is accepted only in Related, Screenshots, Deploy notes and Rollback. Why / What changed / How verified need real content. Template hint comments (`<!-- … -->`) don't count.

**Added automatically from the files you changed:**

| changed | then |
|---|---|
| `db/migrations/**`, `supabase/migrations/**`, anything in `timing-db` | `## Deploy notes` required, `None` not accepted — say whether it's applied to staging and the order it ships in |
| `.env.example`, `app.json`, `app.config.*` | `## Deploy notes` required (`None` ok) |
| `*.tsx` in timing / website / backstage, on a `feat` | `## Screenshots` required (`None — no visible change` ok) |

### Which branch

In **timing, timing-api, timing-calc**, `main` is what's on prod. Day-to-day work (`feat`, `fix`, …) goes to the current version branch (`1.2.x`); only `release`, `hotfix`, `sync` and `revert` target `main`. `release` and `hotfix` always target `main`, in every repo. Background: `timing-api/BRANCHING.md`.

### Templates

The default template loads on every new PR. For the others, add a query parameter to the compare URL:

```
…/compare/main...1.2.12?expand=1&template=release.md
…/compare/main...my-fix?expand=1&template=hotfix.md
…/compare/1.2.12...main?expand=1&template=sync.md
```

### Skipping

Label the PR `skip-pr-lint` (emergencies only — the comment records that it was skipped). Draft PRs and bot PRs aren't checked.

## How it's wired

| file | what |
|---|---|
| `pr-rules.json` | **all the policy**: types, required sections, file and branch rules |
| `lint/lint.mjs` | pure checker (title, sections, branch, file rules) |
| `lint/run.mjs` | the GitHub side: collect facts, keep the one comment up to date |
| `lint/lint.test.mjs` | tests — `node --test lint/lint.test.mjs` |
| `.github/workflows/pr-lint.yml` | reusable workflow |
| `callers/pr-lint.yml` | the ~15-line file each repo carries at `.github/workflows/pr-lint.yml` |
| `pull_request_template.md`, `PULL_REQUEST_TEMPLATE/*` | org-default templates (a repo with its own template overrides these) |

To change a rule, edit `pr-rules.json` (and the table above), run the tests, merge. Every repo picks it up on its next PR event.
