# Harborline submission checklist

**Roadmap:** HL-05. **Evidence reviewed:** 24 November 2026, Asia/Kolkata.
**Status:** partial local documentation; authenticated form-field audit remains
incomplete. No project information was entered, draft saved, or entry submitted
during this audit. Opening the submission entry point was inspection only.

## Sources and evidence boundaries

| Source | Evidence used | Limits |
| --- | --- | --- |
| [Live challenge page](https://truemarkets.devspot.app/challenges) | Opened the “Build the Next Fintech App” panel; its “Required to submit” section lists Project Summary, Video, Demo, GitHub Repository. It names UX, innovation/creativity, and technical execution as judging criteria; prose also emphasizes production readiness and uniqueness. | Public requirement labels are verified. Field formats, length limits and validation rules were not visible in this panel. |
| [Live event overview](https://truemarkets.devspot.app/) | Shows submissions open, closing Nov 29; event Oct 26–Nov 29, winners Dec 14. Authenticated navigation exposed Submit project and Leave hackathon. | Date-only overview does not establish the precise time or timezone. A registration countdown is not evidence of a submission cutoff. |
| [Supplied rules PDF](https://auth.devspot.app/storage/v1/object/public/hackathon-images/resource-images/hackathon_91_rules/49022d6d-4e8b-4dd6-b92d-21b38e1ad058.pdf) | Sections 3–6, 9–10, 14–15 describe entry fields, reviewer access, reuse, judging and DevSpot submission. Text was rechecked from the previously downloaded copy. | Contains proposed/draft wording. Current portal instructions take priority where they settle an earlier uncertainty. The copy was not freshly downloaded in this audit. |
| Registration email supplied by Adesh | Reports submission close as Nov 29, 2026, 11:59 PM UTC. | User-supplied email excerpt, not a fresh mailbox lookup or authenticated form confirmation. |
| Authenticated submission entry point | After user sign-in, Submit project navigated to `https://devspot.app/projects/new?hackathon=91`. A later inspection showed a required Project name field and a Create project button, with further details added inside the project. | Inspection stopped before entering a name or creating a project. Later fields, limits, autosave behavior, and final validation remain unverified. |

## Required artifacts

The live challenge panel resolves the earlier plan's uncertainty about video and
repository requirements: **prepare both as required submission artifacts**.
Earlier wording that video is merely recommended or repository status is still
unconfirmed is superseded by this observation. This does not establish a video
duration limit or a required public-repository visibility rule.

| Artifact or entry detail | Requirement evidence | Harborline content to prepare |
| --- | --- | --- |
| Project summary | Live challenge panel; rules §5 | Name the freelancer's variable-USDC-income problem and explain the commitments → buffer → allowance → approved investment workflow. |
| Video | Live challenge panel | Demonstrate the problem, the cash explanation, a changed commitment, order review, and truthful Gateway evidence. Format and duration remain unverified. |
| Demo | Live challenge panel; rules §5 requires a working reviewer-accessible demo link | Deployed app with an accessible, clearly labeled sample journey; separately identified actual integration evidence. Reviewer access arrangement must satisfy organizer expectations. |
| GitHub repository | Live challenge panel | [Harborline repository](https://github.com/AdeshDeshmukh/harborline), with the reviewed source, lockfile and setup instructions. Confirm any additional access/visibility requirement in the form. |
| Project name | Rules §5; authenticated creation page marks Project name required | Harborline. No character limit was verified. The page says the public address is derived from the initial name and stays the same after renaming. |
| Team/member details | Rules §§3, 5 | Actual contributors and roles; match the registered account/team. Exact form fields not yet inspected. |
| Gateway integration surface | Rules §§5–6; live challenge description | Describe the implemented Gateway workflow and verification steps precisely. No implementation or live-trade claim should be made before it is proven. |

The rules also propose README/setup documentation and an explanation of how to
exercise the integration (§5), and require sufficient reviewer access (§9).
Prepare these regardless of whether they have separate required form fields.

## Timing and submission destination

- Submit through DevSpot; registration, a saved draft, email, Discord membership
  or contacting an organizer does not substitute for final entry submission
  (rules §§3, 5, 14–15).
- The supplied registration email reports **29 November 2026, 23:59 UTC**,
  equivalent to **30 November 2026, 05:29 IST**. Recheck the actual final form
  before relying on its cutoff; the public overview corroborates Nov 29 only.
- The engineering plan's internal target remains **29 November, 18:00 IST**.
  This is our contingency target, not an organizer requirement.
- Preserve the final DevSpot confirmation and timestamp after a separately
  authorized submission. No confirmation exists for Harborline from this audit.

## Form audit still required

Complete the following by reading the authenticated UI. Do not create a blank
project, save placeholder content, accept terms, or submit to discover validation.
If later steps require a saved project, stop and ask for explicit permission.

- [ ] Confirm project/team association and challenge selection.
- [ ] Record every required field and any visible character/file-size limits.
- [ ] Establish whether video is a URL or file upload, accepted hosts/formats,
      duration limit, and link access requirements.
- [ ] Establish demo URL format and reviewer login/access instructions.
- [ ] Establish repository visibility, permissions, branch/commit fields and
      whether a repository must be connected through an integration.
- [ ] Check any image/logo/screenshots, technology tags, declarations, or other
      required fields not listed in the public panel.
- [ ] Read any reuse, AI-assistance, license, or participation declarations.
- [ ] Establish draft/autosave behavior, editing after submission, final button
      semantics, and how the portal distinguishes draft from submitted.
- [ ] Confirm exact cutoff/timezone and expected confirmation evidence.

## Reviewer access and truthful evidence

Before final submission, check each supplied link in a signed-out browser:

- [ ] Demo is reachable and not accidentally blocked by deployment protection.
- [ ] A reviewer can inspect the sample journey without depositing or receiving
      authority to move real funds.
- [ ] Sample balances/fills and actual Gateway evidence remain visibly distinct.
- [ ] Video is viewable without requesting access or signing into its host.
- [ ] Repository and README provide enough access/setup instructions for review.
- [ ] Evidence includes only sanitized records; no keys, signatures, private
      account data, or credentials appear in files, recordings or screenshots.

The user-approved pilot and provider eligibility restrictions remain separate
gates. A public walkthrough alone is not proof of live Gateway execution. Confirm
with the organizer how restricted live access should be reviewed if the form
does not explain it; this audit does not authorize sending that message.

## Recommended preparation, not verified form requirements

- A concise 2–3 minute demo is a proposed narrative length, **not a verified cap**.
- Screenshots, an operational limitations note, and a sanitized integration-proof
  index can make review easier; no separate mandatory screenshot field has been
  verified.
- Identify reused components and material new work as described by rules §6.
  Follow actual disclosure requirements honestly; no special form field has yet
  been verified for AI assistance.

## Final authorization checkpoint

HL-05 records requirements; it is not project submission. After the app and
supporting artifacts are ready, show Adesh the exact final fields and links for
approval. Submit only after explicit approval for that final action and retain
the portal's confirmation. Commit, push, PR creation and merge each retain their
own approval checkpoints.

**Remaining HL-05 audit:** inspect the later form when project creation is
explicitly authorized. Until then, form-field verification remains partial.
