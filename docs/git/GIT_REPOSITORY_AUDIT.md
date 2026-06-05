# BPA Git Repository Audit

**Audit date:** 2026-06-05  
**Scope:** All Bangladesh Pet Association repositories in `D:\BPA_Data`

---

## Summary

| Repository | Git Repo | Current Branch | Origin URL | Clean | Action Required |
|---|---|---|---|---|---|
| backend-api | Yes | `release/V-A1.0.7` | `https://github.com/balagpetcare/bpa_app_api.git` | Yes | Merge release → main, push |
| bpa_app | Yes | `v.10.0.0.1` | `https://github.com/balagpetcare/bpa_app.git` | No | Commit 169 changes, merge → main, push |
| bpa_web | Yes | `release/V-A1.0.8` | `https://github.com/balagpetcare/next_v1.git` | Yes | Merge release → main, push |
| vaccination_2026 | Yes | `main` | `https://github.com/balagpetcare/vaccination_2026.git` | No | Commit 34 changes, push |
| bpa-landing | **No** | — | — | — | Not initialized as git repository |

---

## Repository Details

### 1. backend-api

| Field | Value |
|---|---|
| **Path** | `D:\BPA_Data\backend-api` |
| **Repository name** | `backend-api` |
| **Current branch** | `release/V-A1.0.7` |
| **Remote origin** | `https://github.com/balagpetcare/bpa_app_api.git` |
| **origin/HEAD** | `origin/main` |
| **Last commit** | `862c8ed` — updated Vaccination updare BPA |
| **Uncommitted files** | 0 |
| **Untracked files** | 0 |
| **Modified files** | 0 |
| **main branch** | Exists locally and on remote |
| **main vs current** | `main` is 32 commits behind `release/V-A1.0.7` (fast-forward merge possible) |
| **origin/main vs local main** | In sync (0 ahead / 0 behind) |

**Additional remotes:** None (origin only)

**Branch strategy:** `main` is default branch; release branches (`release/V-A1.0.x`) carry deployment-ready work ahead of `main`.

---

### 2. bpa_app

| Field | Value |
|---|---|
| **Path** | `D:\BPA_Data\bpa_app` |
| **Repository name** | `bpa_app` |
| **Current branch** | `v.10.0.0.1` |
| **Remote origin** | `https://github.com/balagpetcare/bpa_app.git` |
| **origin/HEAD** | `origin/main` (implicit) |
| **Last commit** | `8878f94` — updated Vaccination Campain 2026 |
| **Uncommitted files** | 169 total |
| **Modified files** | 105 |
| **Deleted files** | 1 (`lib/features/settings/presentation/settings_screen.dart`) |
| **Untracked files** | 63 |
| **main branch** | Exists locally and on remote |
| **main vs current** | `main` is 3 commits behind `v.10.0.0.1` (+ uncommitted work) |
| **origin/main vs local main** | In sync (0 ahead / 0 behind) |

**Notable untracked paths:**
- `android/app/google-services.json` (placeholder Firebase config)
- `lib/features/campaign/` (new booking, analytics, geo-targeting modules)
- `lib/core/theme/` (design tokens, typography)
- `lib/features/settings/` (refactored settings module)
- `docs/` (audit and planning reports)
- `integration_test/`, `test/campaign/`
- `app_v7.zip` — **excluded from commit** (14.9 MB build artifact)

---

### 3. bpa_web

| Field | Value |
|---|---|
| **Path** | `D:\BPA_Data\bpa_web` |
| **Repository name** | `bpa_web` |
| **Current branch** | `release/V-A1.0.8` |
| **Remote origin** | `https://github.com/balagpetcare/next_v1.git` |
| **origin/HEAD** | `origin/main` |
| **Last commit** | `740835a` — updated Vaccination updare BPA |
| **Uncommitted files** | 0 |
| **Untracked files** | 0 |
| **Modified files** | 0 |
| **main branch** | Exists locally and on remote |
| **main vs current** | `main` is 62 commits behind `release/V-A1.0.8` (fast-forward merge possible) |
| **origin/main vs local main** | In sync (0 ahead / 0 behind) |

**Additional remotes:**
- `nextv1` — same GitHub host (duplicate tracking)
- `web_app` — alternate remote for historical branches

---

### 4. vaccination_2026

| Field | Value |
|---|---|
| **Path** | `D:\BPA_Data\vaccination_2026` |
| **Repository name** | `vaccination_2026` |
| **Current branch** | `main` |
| **Remote origin** | `https://github.com/balagpetcare/vaccination_2026.git` |
| **origin/HEAD** | `origin/main` |
| **Last commit** | `dcd14d4` — updated Vaccination updare BPA |
| **Uncommitted files** | 34 total |
| **Modified files** | 18 |
| **Untracked files** | 16 |
| **main branch** | Exists locally and on remote |
| **origin/main vs local main** | In sync (0 ahead / 0 behind) |

**Notable changes:**
- Landing page v2 components (CTA system, cards, trust footer)
- New CSS refinement files
- `docs/audits/`, `docs/plans/`, `docs/reports/`

---

### 5. bpa-landing

| Field | Value |
|---|---|
| **Path** | `D:\BPA_Data\bpa-landing` |
| **Git repository** | **Not initialized** (no `.git` directory) |
| **Has `.gitignore`** | Yes (`.env*` ignored) |
| **Action** | Report only — cannot push without git init and remote setup |

---

## Remote Configuration Notes

All four git repositories have valid `origin` remotes pointing to `github.com/balagpetcare/*`.  
`git ls-remote origin` succeeded for all repos — GitHub is reachable and authentication is working.

No remote URLs were modified during this audit.
