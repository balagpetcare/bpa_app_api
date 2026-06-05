# BPA Pre-Push Validation Report

**Validation date:** 2026-06-05  
**Validator:** Automated audit (no force push, no history rewrite)

---

## Validation Summary

| Repository | Status | Blockers | Warnings |
|---|---|---|---|
| backend-api | **PASS** | None | `main` behind release branch (32 commits) — fast-forward merge planned |
| bpa_app | **PASS** (with exclusions) | None | Large zip excluded; pre-existing tracked zips in repo |
| bpa_web | **PASS** | None | `main` behind release branch (62 commits) — fast-forward merge planned |
| vaccination_2026 | **PASS** (with exclusions) | None | `tsconfig.tsbuildinfo` excluded from commit (build artifact) |
| bpa-landing | **SKIP** | Not a git repository | — |

---

## Per-Repository Validation

### backend-api

| Check | Result | Details |
|---|---|---|
| Git status | Clean | No uncommitted changes |
| Merge conflicts | None | `git diff --check` clean |
| Large files (new) | None | — |
| Secrets / `.env` | Pass | No `.env` tracked; `.env*` in `.gitignore` |
| `node_modules` committed | Pass | 0 tracked files |
| Build artifacts committed | Pass | No new build artifacts |
| Origin reachable | Pass | `git ls-remote origin` succeeded |
| `main` exists | Pass | Local and remote |
| Authentication | Pass | Remote listing succeeded |

---

### bpa_app

| Check | Result | Details |
|---|---|---|
| Git status | Dirty | 169 changed/untracked files |
| Merge conflicts | None | Line-ending warnings only (CRLF/LF) |
| Large files (new) | **Excluded** | `app_v7.zip` (14.9 MB) — will NOT be committed |
| Secrets / `.env` | Pass | Only `.env.example` modified (allowed); no `.env` on disk |
| `google-services.json` | Warning | Untracked; contains placeholder values (`project_number: 000000000000`). Safe to commit for CI placeholder. |
| `node_modules` committed | Pass | 0 tracked files |
| Build artifacts committed | Warning | Pre-existing tracked: `android/androidapp.zip`, `assets/images/background.zip` (already in history; not adding new artifacts) |
| Origin reachable | Pass | `git ls-remote origin` succeeded |
| `main` exists | Pass | Local and remote |
| Authentication | Pass | Remote listing succeeded |

**Commit exclusions applied:**
- `app_v7.zip` — build artifact, >1 MB
- `.gradle/` cache files — not in git status (gitignored)

---

### bpa_web

| Check | Result | Details |
|---|---|---|
| Git status | Clean | No uncommitted changes |
| Merge conflicts | None | Clean |
| Large files (new) | None | — |
| Secrets / `.env` | Pass | `.env*` in `.gitignore`; none tracked |
| `node_modules` committed | Pass | 0 tracked files |
| Build artifacts committed | Pass | None tracked |
| Origin reachable | Pass | `git ls-remote origin` succeeded |
| `main` exists | Pass | Local and remote |
| Authentication | Pass | Remote listing succeeded |

---

### vaccination_2026

| Check | Result | Details |
|---|---|---|
| Git status | Dirty | 34 changed/untracked files |
| Merge conflicts | None | Line-ending warnings only |
| Large files (new) | Pass | No files >1 MB in changeset |
| Secrets / `.env` | Pass | `.env.local` exists on disk but is gitignored; not staged |
| `node_modules` committed | Pass | 0 tracked files |
| Build artifacts | **Excluded** | `tsconfig.tsbuildinfo` modified but excluded from commit (build cache) |
| Origin reachable | Pass | `git ls-remote origin` succeeded |
| `main` exists | Pass | Local and remote |
| Authentication | Pass | Remote listing succeeded |

---

### bpa-landing

| Check | Result | Details |
|---|---|---|
| Git status | N/A | Directory exists but `.git` not initialized |
| Origin | Missing | No remote configured |
| Action | Report only | Per instructions: do not auto-create branches or remotes |

---

## Push Strategy

For repositories passing validation:

1. Commit uncommitted changes (where applicable), excluding flagged artifacts
2. `git checkout main`
3. Fast-forward merge from active release/feature branch (backend-api, bpa_app, bpa_web)
4. `git pull origin main --rebase`
5. `git push origin main`

**Safety constraints enforced:**
- No `--force` push
- No history rewrite
- No branch deletion
- No tag removal
- No `.env` / `node_modules` / new build artifacts committed
