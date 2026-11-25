# Dependency security CI

## Gate and scope

The separate `Dependency security` workflow runs on pull requests, pushes to
`main`, and manual dispatch. Its `Dependency vulnerability audit` job uses the
declared pnpm and Node versions to run:

```bash
pnpm audit --audit-level high --ignore-pnpmfile
```

Before invoking pnpm, the job reads `HEAD:pnpm-lock.yaml` with `git show` into a
fresh runner-temporary directory. It supplies a minimal fixed manifest and
workspace definition, then audits there with pnpm hooks disabled. It does not
copy checkout hooks, `.npmrc`, workspace configuration, package scripts,
`configDependencies` or advisory exclusions into the audit directory. Reading
the committed blob also avoids following a working-copy lockfile symlink. The
temporary directory is removed on success or failure.

The lockfile supplies production, development and optional dependencies for
registry checks. Application dependencies are not installed, and no lifecycle
scripts, automatic fixes, lockfile changes, update PRs, database or True Markets
access are part of the audit. The setup actions still install/select the declared
pnpm and Node tools. Existing application CI remains separate and still verifies
a frozen installation, types, tests and build.

High and critical findings fail the check. Moderate and lower findings do not
block this gate; they still need triage. Registry/API failures also fail the job
rather than reporting a clean scan. There are no ignored advisories,
`--ignore-registry-errors`, `continue-on-error` or remediation commands in the
workflow. Registry request retries use pnpm's defaults within the job timeout;
they do not turn errors into success. A new advisory can make the next run fail even when
that PR changes no dependencies.

The workflow uses the same full commit pins as existing CI, `contents: read`,
checkout without persisted credentials, cancellation of superseded runs and a
five-minute job timeout. Fork PRs receive no additional write permissions or
application credentials. It uses `pull_request`, never `pull_request_target`.

## Why a full-lockfile audit

The initial proposal was GitHub's dependency-review action, which compares
dependency changes between revisions. During the 26 November 2026 local check,
GitHub's manifest inventory returned no parsed manifests, dependency comparisons
returned HTTP 403, and SBOM export returned HTTP 404 for this public repository.
Those responses do not establish whether the cause is permissions, graph
configuration or indexing; they do not prove that the feature is disabled.
Consequently, full pnpm transitive coverage through GitHub's graph was not
verified. No repository setting was changed to work around this.

The registry audit instead checks the actual pnpm lockfile without requiring
GitHub graph data. The trade-off is that it scans existing dependencies as well
as changes and depends on registry availability. It is not a PR dependency diff,
a license-policy check, a malware detector, a source-code security review or a
guarantee that packages are safe. Advisory data and reachability require human
judgment. See the [pnpm audit contract](https://pnpm.io/cli/audit).

## Baseline and existing finding

The local audit on the merged HL-23 lockfile reported zero high/critical and one
moderate finding. The moderate finding was development dependency
`drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild@0.18.20`,
[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
The advisory lists affected versions `<=0.24.2` and patched version `0.25.0`;
use that authoritative advisory rather than the CLI's inferred patch hint when
planning a fix. The high-threshold run exited 0; lowering the threshold to
moderate exited 1.
This is not a zero-vulnerability claim or proof that the application's runtime
is exploitable. No package update or ignore entry is included in this CI slice;
the dependency path and an appropriate upgrade belong to a separate triage.
Counts can change with registry advisories; use a fresh report for decisions.

Repository metadata showed secret scanning and push protection already enabled.
Dependabot security updates were disabled. These settings were only read; this
change neither changes them nor enables automatic dependency PRs.

## Rollout and verification limits

Local validation used actionlint v1.7.12 and ShellCheck on both workflows, with
no errors. Eight controlled registry cases exercised the final workflow's actual
shell step with pnpm 11.8.0 and no installed application packages: clean and
moderate-only reports passed; high, critical, development-transitive and optional
findings failed; HTTP 503 and malformed reports failed. The experiment used
synthetic advisories, a local registry and transport/output-only test options
(shortened request retries/timeouts and JSON reporting), not real high/critical
findings. Dependency totals remained 596, including 475 development and 189
optional entries; these categories can overlap. Every case left the checkout
lockfile unchanged, installed no application packages and cleaned up its
temporary audit directory.

The independent review found that pnpm startup in the checkout could load hooks
and configuration before auditing. A harmless sentinel hook and checkout-level
advisory exclusion reproduced this: the original command ran the hook and
suppressed a synthetic high finding. The isolated workflow ran no hook, retained
runtime/development/optional coverage and rejected the finding despite a
different working-copy lockfile. That review finding was fixed and verified in
one pass; no second independent review was performed.

The final isolated workflow step also passed against the real registry, reporting
the same one moderate finding. There is no clean-vulnerability claim.

Application code and dependencies are unchanged, so the full application suite
was not rerun for this configuration/documentation slice. A local run cannot
prove a GitHub-hosted job ran. After separate
commit, push and PR approval, verify this job on the exact PR revision and then
on the merged default branch. Only after observing successful hosted runs should
the owner consider requiring `Dependency vulnerability audit` in repository
rules; that settings change requires separate approval.

No scheduled scan is configured. Existing packages are rechecked when a PR,
`main` push or manual run occurs. Browser/accessibility CI remains with HL-29/30.
