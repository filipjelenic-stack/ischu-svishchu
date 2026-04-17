# Project rules — ischu-svishchu

These rules apply to every session working on this project. They override default behavior.

## 1. Always sync with GitHub before work

Before starting any new operation, restart, or task, **always check GitHub for the latest version** of this repo. The live app is auto-deployed to Vercel from `main` on `https://github.com/filipjelenic-stack/ischu-svishchu`, so local copies can drift if commits were pushed from elsewhere (e.g. a different machine, a different agent, or a hotfix via GitHub UI).

At the start of every session and before any edit:

```bash
cd C:/Projects/ischu-svishchu-prod
git fetch origin
git status
git log --oneline origin/main ^HEAD    # commits on remote not in local
git log --oneline HEAD ^origin/main     # local commits not on remote
```

If `origin/main` is ahead, **pull before editing** (`git pull --ff-only origin main`). Never start editing `index.html` without confirming the local copy matches `origin/main` — otherwise a push will either clobber remote commits or require a messy merge.

If local is ahead (uncommitted or unpushed work from a prior session), surface that state before proceeding so we don't overwrite it.

## 2. Run all tasks autonomously — no approval prompts

Do not ask for permission to:
- run tests
- edit files
- install/upgrade dependencies
- commit and push to `main`
- run the dev server or preview tools
- execute scripts, evals, or diagnostics

Just do the work end-to-end and report results. Approvals required by Claude Code's own permission system (tool allowlists, git pushes to protected branches, destructive ops like `reset --hard` or `push --force`) still stand — those are enforced by the tool, not by asking the user. For everything else: act, don't ask.

Exceptions where you **should** still check in:
- Destructive git operations (`reset --hard`, `push --force`, `branch -D`)
- Deleting user data or non-reversible schema migrations
- Changes that touch billing, auth secrets, or production credentials

## Repo layout reminder

- `C:/Projects/ischu-svishchu-prod/index.html` — **the real production file** deployed to Vercel. This is what to edit.
- `C:/Projects/ischu-svishchu/ischu-svishchu.html` — older/local scratch copy. Not deployed. Don't confuse the two.
- Remote: `https://github.com/filipjelenic-stack/ischu-svishchu` (branch: `main`)
