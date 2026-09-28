---
name: git-commit
description: Create Git commits by splitting changes into logical units following project conventions. Check repository-specific branch rules before applying the Git Flow defaults.
allowed-tools: Bash
---

## Step 0 — Branch Check (Required)

Check the remote and current branch first:

```bash
git remote get-url origin
git branch --show-current
```

### Temporary repository: `tmp-it-play/nxdi`

When `origin` points to `tmp-it-play/nxdi` on GitHub (HTTPS or SSH, with or without `.git`), follow the temporary workflow in root `AGENTS.md`:

- Create new work branches from the latest `origin/main` and target `main` for PRs.
- If currently on `main`, inspect the changes, infer a `<type>/<kebab-case-description>` branch name, and run `git fetch origin` followed by `git switch --no-track -c <type>/<inferred-name> origin/main` before committing. Preserve any local changes; do not reset or discard them to switch branches.
- If already on a work branch, continue there after checking that it follows the `main` branch policy.
- Skip the Git Flow defaults below and continue with the commit flow.

This override stops applying as soon as `origin` no longer points to the temporary repository. On return, revert all repository-migration edits to this skill, the `write-pr` skill, and its PR creation script to their pre-migration contents using root `REPOSITORY_RETURN_GUIDE.md`. Preserve unrelated later edits and follow the original repository's current branch policy.

### Git Flow defaults (outside the temporary repository)

**If current branch is `develop`:**

This project uses Git Flow. Feature branches must be created from `develop` and merged back into `develop`.

1. Analyze all changes with `git status` and `git diff`
2. Infer an appropriate branch name from the changes:
   - Format: `<type>/<kebab-case-description>` — use the same type as the planned commit (exception: use `cicd/` for `ci/cd` type)
   - Reflect the domain scope in the name
   - Examples: `add/add-student-major-filter`, `fix/auth-api-key-deletion`, `refactor/optimize-club-query`
3. Create and checkout the branch:
   ```bash
   git checkout -b <type>/<inferred-name>
   ```
4. Proceed with the commit flow below

**If current branch is NOT `develop`:** proceed directly to the commit flow.

---

## Commit Message Rules

Format: `type(scope): 설명`

- **Types**: `add` / `update` / `fix` / `refactor` / `ci/cd` / `docs` / `test` / `merge` (English)
- **Scopes** (English):
  - **Primary**: Domain names — infer from changed file paths and directory structure
  - **Cross-cutting concerns only**: Module names or `global`
  - Use domain names by default. Only use module names when changes affect multiple modules or are cross-cutting.
- **Description**: Korean, no period, avoid endings: `~한다/~된다`, `~하기/~하기 위해`, `~합니다/~됩니다`, `~했습니다`
  - Good examples: `엔티티 필드 추가`, `트랜잭션 롤백 방지`, `로직 개선`
- Subject line only (no body)
- Do NOT add AI tool as co-author

## Scope Selection

For the full scope selection table and examples, read `.agents/skills/git-commit/references/scope-guide.md`.
For commit type and scope naming conventions, read `.agents/skills/git-commit/references/commit-conventions.md`.

Quick rule: infer domain from changed file paths and directory structure. Use `global` / `ci/cd` / module names only for cross-cutting changes.

## Commit Flow

1. Inspect changes: `git status`, `git diff`
2. Categorize into logical units (feature / bug fix / refactoring / etc.)
3. Group files per unit
4. For each group:
   - Stage only relevant files with `git add`
   - Write a commit message following the rules above
   - `git commit -m "message"`
5. Verify with `git log --oneline -n <count>`
