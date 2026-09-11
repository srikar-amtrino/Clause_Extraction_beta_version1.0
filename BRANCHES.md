# Git Branching Strategy — Accorder Backend

## Branch Map

```
main                          ← production-ready only. Never commit directly.
└── develop                   ← integration branch. All work lands here first.
      ├── backend/...         ← all backend feature branches
      └── frontend/...        ← all frontend feature branches
```

---

## The Branches

### `main`
- Represents what is **deployed / demo-ready**.
- **No one commits directly to `main`**.
- Only merged from `develop` when a milestone is stable and agreed upon.
- The team lead opens and merges the PR from `develop → main`.

### `develop`
- The **shared integration branch**. This is where the day-to-day work lives.
- Backend and frontend branches merge **into `develop`** via Pull Request.
- Before merging, the branch must be up to date with `develop` (rebase or merge).
- Treat `develop` as always-working — don't merge broken code.

### `backend/*`
- Owned by the backend team.
- Branched off `develop`. Merged back into `develop` via PR.
- Naming: `backend/<scope>` — see naming rules below.

### `frontend/*`
- Owned by the frontend team.
- Branched off `develop`. Merged back into `develop` via PR.
- Naming: `frontend/<scope>` — see naming rules below.

---

## Branch Naming Rules

```
backend/document-pipeline-models      ← setting up all 14 DB models
backend/document-pipeline-services    ← service layer logic
backend/document-pipeline-tasks       ← Celery tasks
backend/document-pipeline-admin       ← Django admin registrations
backend/core-models                   ← User, Sector, AuditLog models
backend/token-accounting              ← TokenUsageLog model
backend/realtime-consumers            ← WebSocket consumers
backend/settings-and-config           ← settings/, config/, requirements

frontend/project-setup                ← Vite / React scaffold
frontend/review-workspace             ← the main clause review UI
frontend/document-library             ← document list + filters
frontend/vector-index                 ← vector DB health screen
frontend/overview-dashboard           ← landing screen
```

**Rules:**
- All lowercase, words separated by `-`
- Always prefixed with `backend/` or `frontend/`
- Keep scope tight — one feature or layer per branch
- Don't name branches after people (`srikar-work` = bad)

---

## Day-to-Day Workflow

### Starting a new piece of work

```bash
# Always start from an up-to-date develop
git checkout develop
git pull origin develop

# Create your branch
git checkout -b backend/document-pipeline-models
```

### Saving work (commit often, commit small)

```bash
git add .
git commit -m "feat(models): add Document and ContractType model stubs"
```

**Commit message format:**
```
<type>(<scope>): <short description>

type  : feat | fix | refactor | chore | docs | test
scope : models | services | tasks | consumers | settings | admin | ui
```

Examples:
```
feat(models): add Chunk model with immutable text field
feat(services): scaffold publish_service with blockers check stub
fix(tasks): correct Celery task routing for embed queue
chore(settings): add INSTALLED_APPS entries for all four apps
docs(admin): register all document_pipeline models in admin
feat(ui): scaffold review workspace table layout
```

### Pushing your branch

```bash
git push origin backend/document-pipeline-models
```

### Opening a Pull Request

1. Go to GitHub → **New Pull Request**
2. **Base branch: `develop`** ← target is always `develop`, never `main`
3. **Compare: your feature branch**
4. Add a short description of what changed
5. Tag the team lead as reviewer
6. Wait for review before merging

### Keeping your branch up to date (do this often)

```bash
# While on your feature branch:
git fetch origin
git rebase origin/develop
```

If there are conflicts, resolve them, then `git rebase --continue`.

---

## Merge Rules

| From | To | Who merges |
|---|---|---|
| `backend/*` | `develop` | Author opens PR, team lead approves |
| `frontend/*` | `develop` | Author opens PR, team lead approves |
| `develop` | `main` | Team lead only, at milestone checkpoints |

- **Squash commits** before merging if the branch has noisy WIP commits.
- **Delete the branch** after merging — keep the remote clean.
- Never force-push to `develop` or `main`.

---

## What To Do Right Now (First Time Setup)

Each team member runs this once after cloning:

```bash
git clone https://github.com/srikar-amtrino/Clause_Extraction_beta_version1.0.git
cd Clause_Extraction_beta_version1.0
git checkout develop
```

Then pick up the branch assigned to you and start from there.

---

## Branch Assignments — Sprint 1

| Branch | Owner | Goal |
|---|---|---|
| `backend/settings-and-config` | Srikar | Wire up settings/, INSTALLED_APPS, requirements.txt, .env.example |
| `backend/document-pipeline-models` | Sanjay | All 14 model stubs in document_pipeline/models/ |
| `backend/core-models` | Srikar | User, Sector, AuditLog, Notification models |
| `frontend/project-setup` | Vamshi | React + Vite scaffold, folder structure, base routing |

---

## Quick Reference Card

```
# Start work
git checkout develop && git pull origin develop
git checkout -b backend/<your-scope>

# Daily
git add . && git commit -m "feat(scope): description"
git push origin backend/<your-scope>

# Stay in sync
git fetch origin && git rebase origin/develop

# Done → open PR on GitHub (base: develop)
```
