# Contributing to Harborline

Work follows the [delivery roadmap](./harborline-product-and-architecture-plan.md#18-pr-delivery-roadmap-labels-and-progress-tracking).
Each change should have a clear purpose, a bounded review, and evidence for the
behavior it affects. The [README](./README.md) describes the current application
and local setup; planned architecture does not imply implemented functionality.

## Scope and tracking

Use stable roadmap IDs such as `HL-01` in PR descriptions. These IDs are separate
from GitHub's issue and PR numbers. Open an issue when a problem, bug, external
blocker, or design decision needs discussion. Routine implementation can refer
directly to the roadmap; an issue is not required for every commit or PR.

Keep implementation, meaningful tests, and the documentation needed to use the
change together. Split work where two outcomes can be reviewed independently.
Avoid splitting tests from the behavior they protect or merging an unfinished
financial path that users can invoke.

## Branches and commits

Start independent branches from current `main` after prerequisites merge. Use
`<type>/hl-NN-short-purpose`, such as `feat/hl-14-allowance` or
`docs/hl-02-project-documentation`. HL-01 uses `chore/hl-01-foundation`.
Use purpose-based names without tool or assistant branding in branch names,
commit messages/trailers, or PR titles and descriptions. Preserve accurate
authorship and any required disclosures.
Wait for dependencies where practical. If a stacked branch is necessary, state
its base and dependencies in the PR and update the base before merging.

Use concise commit messages that describe one coherent change:

```text
chore: establish application foundation
docs: document local setup and architecture
feat(planning): calculate investment allowance
fix(orders): retain uncertainty after execution timeout
```

Use `feat`, `fix`, `docs`, `chore`, `ci`, `refactor`, or `test` according to the
actual change. A `test` commit may strengthen existing behavior; required feature
tests should still be included with the feature. Stage explicit paths and review
the staged diff so local work from another slice is preserved. Automated agents
must have explicit authorization before committing, pushing, opening PRs, merging,
or changing remote labels.

## Pull requests

Use the [PR template](./.github/pull_request_template.md). Include its text
explicitly when preparing the initial PRs. Describe the final diff for someone
who has not seen the development conversation. Remove optional sections that do
not apply, replace placeholders, and leave review boxes unchecked until verified.

For visible changes, include a screenshot or recording. For consequential design
choices, explain the alternatives, cost, and condition that would justify
reconsidering the decision. Link `Closes #N` only when the PR completes that issue.

Apply one type label and usually one area label from
[the label catalog](./.github/labels.json). Up to three areas are appropriate for
a change that actually crosses those boundaries. Add `blocked` only with a stated
dependency and remove it when resolved. Use phase milestones instead of phase
labels; GitHub PR state already communicates draft/open/merged status.

The label catalog is proposed repository configuration. It does not synchronize
labels or modify GitHub by itself. When applying it later, inspect existing labels
and preserve unrelated ones rather than deleting them to match the catalog.

## Verification

Follow the README's frozen install and generated-type setup. The baseline checks
are `pnpm lint`, `pnpm typecheck`, and `pnpm build`. Record the runtime and observed
results. Node 24 is the deployment target; Node 24 CI remains pending until HL-04.

Add the tests needed to prove the specific behavior changed. Prose-only changes
need link/content checks; they do not need invented application tests. Unit,
contract, PostgreSQL integration, and browser suites will be introduced with the
features they verify. Record unavailable checks and their limits honestly.

For financial changes, check ownership, consent, exact amount/fee bounds, stale
inputs, concurrent approvals, and uncertain provider outcomes as applicable.
Use the architecture plan's Review Focus and the owning slice's acceptance checks.
Fixture success, a successful build, deployed availability, and real Gateway
execution are different evidence and should be described precisely.

Keep secrets and private financial data out of commits, screenshots, logs, and
test fixtures. CI must never move real funds. Live experiments require separately
approved eligibility, asset/network, amount, signing, recovery, and return steps.

## Initial review sequence

The initial review stack contains the following slices. Preserve their
boundaries when preparing changes:

| Slice | Intended file scope |
| --- | --- |
| HL-01 | App source, package/lockfile, framework/tooling configuration, `.nvmrc`, `.gitignore`, and `AGENTS.md` |
| HL-02 | README, `.env.example`, product/architecture plan, and book summary |
| HL-03 | This guide, PR template, and label catalog |
| HL-04 | CI workflow and any necessary CI-specific configuration |

Prepare each actual PR against its appropriate base and record its real URL in
the roadmap when opened. Local verification is not a merge or a submission.
