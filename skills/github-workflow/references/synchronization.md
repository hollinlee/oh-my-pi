# Branch Synchronization and Recovery

## Purpose

Keep each explicit issue based on a known remote base revision, detect branch drift before side effects, and resume failed delivery from the nearest reliable stage.

## Synchronization checkpoints

1. Before starting an issue, require a clean worktree. Fetch the remote base branch and fast-forward the local base branch only.
2. Create the issue branch from the fetched remote base branch. Record the base SHA and issue branch head SHA before implementation.
3. Before commit and PR creation, fetch the remote base branch again. If the base SHA changed, the feature branch is behind, or mergeability is unclear, stop and reassess before pushing.
4. After merge, switch to the base branch, fetch the remote base branch, fast-forward only, and verify that local and remote base SHAs match before starting the next issue.

## Safe automatic actions

- Fetch remote refs.
- Fast-forward a clean local base branch.
- Create a new issue branch from the current remote base.
- Re-run verification after a confirmed, in-scope update that has one clear resolution.
- Resume from an existing commit, branch, PR, checks state, or merge state after inspecting it first.

## Human decision gates

Stop the queue when the worktree is dirty or ownership is unclear, synchronization conflicts, base drift requires changing a published branch, rebase or force-push would be needed, mergeability is unknown, or the recovery action has more than one reasonable interpretation.

Never overwrite user changes, reset a base branch, force-push a published branch, or silently resolve a conflict.

## Recovery entry points

- Implementation or verification failure: remain on the current issue branch and fix only a unique, in-scope defect.
- Commit or push failure: inspect existing commits and remote branch state before retrying; do not create a duplicate commit.
- PR creation failure: resume with `/create-pr` after checking whether a PR already exists.
- Review failure: resume with `/handle-review` after checking existing comments, reviews, and checks.
- Merge failure: resume with `/merge-pr` after rechecking authoritative blockers.
- Synchronization conflict: pause for a human decision; preserve all artifacts and do not rewrite history.

## Queue invariant

Process only the explicit issue queue, one issue at a time. Start the next issue only after the current PR is merged, the local base branch is fast-forwarded to the remote base SHA, and the worktree is clean.
