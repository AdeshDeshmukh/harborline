# System design books: a practical engineering guide

This guide synthesizes eight PDFs supplied for study. It is a reusable method for making software decisions, not a design for a particular project. It paraphrases the books and adds an engineering workflow that connects their ideas.

**Reading scope:** The PDFs total about 5,300 pages. Their contents were indexed and the sections most relevant to architecture, data correctness, distribution, testing, and tradeoffs were studied directly. This is a focused synthesis, not a claim that every page or example was read. PDF page references below point to the PDF viewer's page count, which may differ from printed page numbers. The two Alex Xu files substantially overlap and are treated as two copies of one guide.

## 1. The senior engineer's starting point

A strong design begins with the problem and its constraints. A diagram drawn before these are known can be polished yet wrong. Start by writing:

1. **User and business outcome.** Who needs the system, what task must it complete, and how will we know it succeeded?
2. **Core behaviors.** What must work in the first release? Which behaviors can wait?
3. **Invariants.** What must never happen, even during failures or concurrent requests? Examples: no duplicate charge, no cross-customer data access, no negative spendable balance.
4. **Quality priorities.** Choose a small number of characteristics that matter most: correctness, security, recovery, latency, availability, maintainability, cost, or another explicit need.
5. **Operating context.** Current users, likely growth, team size, deadline, skills, budget, deployment environment, external dependencies, and legal constraints.
6. **Unknowns.** Distinguish facts, assumptions, and hypotheses needing measurement or a small experiment.

Alex Xu's framework starts with scope and assumptions before a high-level design and deeper investigation. *Head First Software Architecture* warns that pursuing too many architecture characteristics adds complexity. *Fundamentals of Software Architecture* asks engineers to define characteristics concretely enough to evaluate them. [Xu, vol. 1, PDF pp. 55–62; Xu, second file, PDF pp. 42–49; Head First, PDF pp. 145–148; Fundamentals, PDF pp. 159–161]

**Decision rule:** Prioritize risks that can invalidate the product or cause irreversible harm. Do not optimize for hypothetical scale while a core behavior remains unproven.

## 2. How to make an architectural decision

Architecture is a series of consequential tradeoffs. No style is universally best. Use this sequence for decisions that are costly to reverse:

| Step | Question | Output |
| --- | --- | --- |
| Frame | What problem and invariant does this choice address? | One-sentence decision statement |
| Set criteria | Which two or three qualities matter most here? | Ranked criteria with measurable meaning |
| Generate options | What are two credible approaches, including the simpler one? | Alternatives, not a preferred technology in disguise |
| Trace coupling | Which components, data, teams, and workflows would change together? | Dependencies and ownership |
| Test failure modes | What happens during timeout, duplicate request, stale read, partial failure, and recovery? | State transitions and recovery path |
| Compare costs | What are build, operating, learning, migration, and opportunity costs? | Tradeoff table |
| Decide | Which option best serves current evidence and constraints? | A decision and its consequences |
| Revisit | What signal would make us reconsider? | Trigger and owner |

Record major decisions in a short architecture decision record (ADR): **title, status, context, decision, alternatives, consequences, and revisit trigger**. The record explains why the decision was reasonable when made. Avoid turning every library choice into an ADR; reserve it for choices that shape boundaries, consistency, security, deployment, or long-term flexibility. [Fundamentals, PDF pp. 700–701; Head First, PDF pp. 239–244; Hard Parts, PDF pp. 417–422]

### A useful tradeoff table

Compare options against the same criteria. Describe costs and failure modes rather than checking a vague “best practice” box.

| Option | Benefits | Costs and risks | Evidence needed | Revisit when |
| --- | --- | --- | --- | --- |
| Simple baseline | Fast delivery and fewer moving parts | May constrain a future requirement | Estimate workload and test core flow | A measured limit is reached |
| More complex option | Addresses a specific proven pressure | More coordination and operational burden | Demonstrate that pressure exists | Its benefit exceeds the added cost |

The *Hard Parts* method examines what is entangled, how parts are coupled, and the consequences of change. *Software Engineering at Google* broadens cost beyond money to include engineering time, operational effort, opportunity cost, and effects on users. [Hard Parts, PDF pp. 417–422; Google, PDF pp. 40–44]

## 3. Boundaries, modules, and change

Organize software around business capabilities and responsibilities. A module should have a clear purpose, own its rules, and expose a small interface. Keep the rules that define the product separate from database records, HTTP payloads, framework objects, and external vendor formats. This makes the product's important behavior easier to test and change. [Clean Architecture, PDF pp. 204–219]

The dependency direction matters: high-level policy should not need to import low-level implementation details. An adapter can translate between a vendor response and an internal concept. This does **not** require a separate service or a large interface hierarchy for every function. Boundaries themselves cost code and maintenance. Apply a full boundary where external change, security, or independent ownership makes it valuable; use a lighter boundary elsewhere. [Clean Architecture, PDF pp. 216–229]

A modular monolith is one deployable application with explicit domain modules. It can support fast development and local transactions while preserving code boundaries. Its failure mode is unrestricted imports and shared tables that turn it into a tangled codebase. Separate services become attractive when independent deployment, scale, or ownership is valuable enough to justify network failures and distributed consistency work. [Fundamentals, PDF pp. 305–309; Hard Parts, PDF pp. 215–218, 280–285]

**Boundary review:**

- Can this module's business behavior be understood without reading its UI or vendor adapter?
- Who owns each piece of data and each state transition?
- Does changing one rule force unrelated modules to change?
- Can a caller bypass an important invariant by using a lower-level API directly?
- Is the separation solving a current problem or merely anticipating one?

## 4. Data correctness and concurrency

Specify **the source of truth** for each fact. A local database may own user preferences and application intent while an external provider owns actual transaction status. A cached or derived value must state its freshness and how it is rebuilt.

Transactions make a set of database operations atomic, but the chosen isolation level may still allow races. A read, calculation, and write can lose an update when requests overlap. Two requests can also update different rows while jointly violating a shared rule, known as write skew. For each invariant, choose an enforcement mechanism: a database constraint, atomic update, row lock, serializable transaction, or carefully designed compare-and-set. Test simultaneous requests against the real database behavior. [DDIA, PDF pp. 310–327]

**Money-related rule:** Numeric representation must preserve the needed precision and rounding behavior. Define currency, scale, rounding point, and whether an amount is estimated, authorized, reserved, settled, or displayed. Never infer that a visual balance is authoritative merely because it was recently rendered.

### Duplicates and retries

A timeout creates uncertainty: the remote action may have succeeded while its response was lost. Retrying blindly can repeat a financial action. Assign a durable operation identifier at the user's intent boundary and use it throughout the local workflow. Enforce uniqueness in the database. Before repeating a remote mutation after an ambiguous response, query its status or reconcile against the provider's record. A local unique key alone does not guarantee end-to-end exactly-once execution unless the provider also supports the necessary semantics. [DDIA, PDF pp. 682–684]

Classify retries:

- **Safe read retry:** The request only retrieves data and duplicate reads have no side effect.
- **Known rejected mutation:** The provider explicitly confirms that nothing was executed; retry under its documented rules.
- **Ambiguous mutation:** Persist uncertainty, look up the operation, and avoid issuing a new action until its outcome is known.
- **Permanent failure:** Present the reason and a recovery path; do not loop indefinitely.

Use a state machine for operations whose intermediate states matter. Name allowed transitions and terminal states. Persist the state before or immediately after each side effect as appropriate, and provide reconciliation for interruptions. The state machine should reflect actual provider semantics rather than UI optimism. [Hard Parts, PDF pp. 369–371]

## 5. Distributed systems: where complexity begins

Once a workflow crosses a network, partial failure becomes normal: one participant may be healthy while another fails, a response may be delayed, and the caller may not know the outcome. These issues exist even in a small application that calls one external API. Design observable recovery, not only a happy path. [DDIA, PDF pp. 364–367]

Splitting one business workflow across separately deployed services removes the convenience of one local ACID transaction. Independent commits can leave temporary inconsistency; recovery requires explicit state, retries, compensation, or manual repair. This is a strong reason to preserve local atomicity where it serves the business, while acknowledging that the external API boundary remains distributed. [Hard Parts, PDF pp. 215–218, 281–285]

The correct amount of distribution depends on the system's real pressure. Queues, caches, service meshes, and event streams each address particular needs and introduce their own state and failure modes. Add one only after stating the measured pressure and the new operational responsibility. An interview design for millions of users is a useful thought experiment, not a default starting architecture. [Xu, vol. 1, PDF pp. 55–62; Hard Parts, PDF pp. 417–422]

## 6. Reliability, observability, and operations

For every critical workflow, answer:

1. What is the last durable state before an external call?
2. What if the process crashes before sending, after sending, or after the provider acts but before responding?
3. Can the operation be identified and queried after restart?
4. What is visible to the user while the outcome is unknown?
5. What metric or log alerts an operator that reconciliation has stalled?
6. Which failures need human intervention, and what information will that person need?

Track operation IDs across user request, local records, logs, and provider calls. Log meaningful state transitions and error codes without leaking credentials or sensitive data. Monitor failures that affect correctness, such as stuck operations, reconciliation lag, duplicate suppression, and unexpected transitions. Performance measures should include tail behavior where outliers matter; averages alone can hide poor experiences. [Fundamentals, PDF pp. 159–161; Hard Parts, PDF pp. 369–371]

Recoverability should be demonstrated. Simulate interrupted requests, restart the application, and confirm the workflow reaches a truthful terminal state. A clean error message is useful, but recovery is an engineering property.

## 7. Security and trust boundaries

Identify actors, assets, and authority before choosing authentication. Ask who may read, create, approve, sign, and execute each action. Authenticate the caller, then authorize the specific resource and action. A user ID in a request is a claim, not proof of ownership.

Keep secrets out of client bundles, source repositories, logs, screenshots, and documentation. Limit the scope of each credential. For high-impact actions, record who approved what, when, and under which terms. Separate an informational preview from a mutation. Evaluate the harm of a compromised dependency or a stale authorization decision.

These are engineering principles synthesized across the books' discussions of boundaries, end-to-end guarantees, and early defect detection; exact controls depend on the product and its threat model. [Clean Architecture, PDF pp. 216–219; DDIA, PDF pp. 683–684; Google, PDF pp. 39–40]

## 8. Testing as evidence of behavior

Test the guarantees users rely on, including edge cases and failure recovery. Do not mirror each implementation method with a test. A useful test names the initial state, action, and expected outcome. [Google, PDF pp. 396–398]

Use the smallest test that can prove a claim:

- **Small deterministic tests:** Pure business calculations, state transitions, input validation, and policy decisions.
- **Local integration tests:** Database constraints, concurrent updates, persistence, adapters, and request handling.
- **End-to-end tests:** A small number of critical user journeys and provider integration checks.

Small tests are generally faster and more deterministic; larger tests cover integration risks that small tests cannot. The book treats test **size** (resources and runtime) separately from test **scope** (behavior exercised). Test doubles help isolate code, but they cannot establish that a real provider contract or deployment works. [Google, PDF pp. 355–358]

For consequential operations, include tests for duplicate submission, concurrent requests, timeout before response, stale data, partial provider failure, process restart, unauthorized access, and reconciliation. Avoid tests that merely repeat the code's implementation steps; they provide little independent evidence.

## 9. Maintainability and evolution

Software engineering is programming across time: code, tests, documentation, reviews, tooling, and team practices must support change. Choose conventions that a new engineer can understand. Document decisions whose reasons will otherwise be forgotten. Make critical behavior legible in code and tests. Detect defects early, when they are cheaper to correct. [Google, PDF pp. 39–44]

Keep options open where uncertainty is real and the cost is modest. Avoid both irreversible coupling and speculative abstraction. Revisit a boundary when a concrete change repeatedly crosses it, ownership changes, or an operating limit is measured. Revisit a datastore when its actual workload exposes a mismatch. Revisit deployment topology when a component needs independent scaling or release cadence.

## 10. A practical review before implementation

Use this checklist to assess a proposed system without committing to any particular stack:

### Product and scope

- Can we state the user task and success criterion in one paragraph?
- Are facts, assumptions, and experiments distinguished?
- Is the first complete workflow identified?
- Which use cases are deliberately deferred, and why?

### Correctness and data

- What invariants must hold under concurrency?
- Who owns each datum, and which values are derived or cached?
- Where are uniqueness and authorization enforced?
- What is the source of truth after a timeout?
- How are money, precision, and rounding defined?

### Operations and safety

- What failures leave an operation uncertain?
- How does reconciliation discover and repair those states?
- What evidence proves an action actually completed?
- What can operators observe without exposing secrets?
- Can the system be restored and the critical workflow resumed?

### Design and cost

- What are the simplest credible and more elaborate options?
- Which quality priorities determined the choice?
- What complexity did the choice add?
- What signal would justify revisiting it?
- Has the decision been recorded clearly enough for someone new to challenge it?

## 11. Choosing a system shape

Choose the simplest shape that satisfies the **current** invariants and quality priorities. A system's component count is not evidence of maturity. The decision must name the pressure that each component relieves.

| Choice | Prefer when | Main benefit | Main cost or failure mode | Evidence that should prompt change |
| --- | --- | --- | --- | --- |
| One deployable application | One team owns the workflow; local consistency and fast iteration matter | Simple deployment, debugging, and local transactions | Module boundaries can erode; whole app deploys together | Independent release or scale needs recur |
| Modular monolith | Distinct business capabilities exist but independent deployment is unnecessary | Clear ownership with one deployable unit | Cross-module imports and shared data can create hidden coupling | Repeated boundary violations or separate teams with different release needs |
| Separate services | Distinct ownership, deployment, or scaling is proven | Independent lifecycle and fault isolation when properly designed | Network failure, data duplication, distributed consistency, operations | Service boundary costs exceed the independence gained |
| Synchronous request | Caller needs an immediate result and latency is acceptable | Simple control flow and direct feedback | Caller waits on dependencies; timeout creates uncertainty | Long-running work, burst pressure, or dependency failures dominate |
| Asynchronous work | Completion can happen later and durable work can be tracked | Absorbs bursts, isolates latency, supports retries | Eventual consistency, duplicate delivery, stuck-work recovery | User requires immediate result or coordination burden exceeds benefit |

**Decision discipline:** A monolith can be well designed; a service can be poorly isolated. Evaluate module ownership and runtime behavior separately. Moving code into another process changes failure and consistency properties. It does not automatically improve the business design. [Fundamentals, PDF pp. 305–309; Hard Parts, PDF pp. 215–218, 281–285]

## 12. Data, storage, and cache choices

Start with access patterns and invariants, then choose storage. List the entities, expected reads and writes, query shapes, retention requirements, concurrency patterns, and recovery needs. If relationships and multi-row invariants are central, a relational database is often a strong default. A specialized database is justified by a workload it handles materially better, with an explicit plan for ownership and synchronization. This is a reasoning guide, not a claim that one database is universally correct. [DDIA, PDF pp. 310–327; Hard Parts, PDF pp. 280–285]

Classify every value:

| Class | Example | Required handling |
| --- | --- | --- |
| Authoritative | Accepted user instruction, provider-confirmed transaction | Durable write, ownership, auditability |
| Derived | Available amount computed from commitments | Document formula and rebuild path |
| Cached | Recently fetched price or profile | Freshness limit and invalidation rule |
| External | Vendor order status | Reconcile and display provider uncertainty |
| Historical | Prior approved terms or decision | Preserve enough context to explain the outcome |

**When to cache:** Add a cache when repeated reads create measured latency or cost and stale values are tolerable. Define a time-to-live, invalidation trigger, fallback behavior, and whether stale data may be used for a decision. A cache that affects authorization or money movement requires more scrutiny than a cache used for display. Avoid maintaining two writable sources of truth for the same fact.

**When to replicate or denormalize:** Read performance or reporting needs may justify a derived projection. Keep its source, transformation, refresh mechanism, and lag visible. If a projection is behind, do not present it as an exact current fact. Rebuilding it from authoritative records should be possible.

**When to partition:** First measure data size, throughput, or locality pressure. Partitioning adds cross-partition query and transaction costs. Select keys from real access patterns and identify skew, migration, and rebalancing behavior before adopting it. Interview examples can teach the technique without creating a present need for it. [Xu, vol. 1, PDF pp. 55–62; DDIA, PDF pp. 310–327]

## 13. APIs and external contracts

A good contract names concepts precisely, validates inputs, reports errors that callers can act on, and lets a client identify the result of a request. Prefer stable identifiers over display names for records whose labels may change. Specify which operations are reads, which mutate state, and which are safe to repeat.

For each mutation, document:

1. Preconditions and authorization.
2. Request identity and deduplication behavior.
3. State created before calling a dependency.
4. Possible immediate and eventual responses.
5. What the caller does after timeout.
6. How to query or reconcile the result.
7. Which fields are immutable after approval.

Keep vendor contracts at the system boundary. Translate provider-specific statuses into internal concepts only when the mapping preserves meaning. Keep the original provider identifier and enough raw evidence for support and reconciliation. A contract test should detect when an integration no longer matches the provider's behavior. [Clean Architecture, PDF pp. 216–219; DDIA, PDF pp. 682–684]

**Versioning rule:** Prefer additive changes when consumers exist. When behavior or semantics must change, identify affected callers, support a migration window where feasible, and remove the old path deliberately. A version number does not replace compatibility analysis.

## 14. Workflow design and failure tables

For a consequential workflow, write a state table before implementation. A useful state model distinguishes **proposed**, **approved**, **submitted**, **uncertain**, **confirmed**, **rejected**, and **canceled** where those meanings apply. An approval is an authorization of specific terms; it is not proof of execution. A submitted operation may remain unsettled.

| Failure point | What may have happened | Required response |
| --- | --- | --- |
| Before local intent is saved | No durable record | Ask the user to retry; do not claim submission |
| After intent is saved, before remote call | Nothing remote should have happened | Resume from the durable intent |
| During remote call | Remote result may be unknown | Keep an uncertain state and look up the operation |
| Remote success, local update fails | Remote action happened but local view is behind | Reconcile using the provider identifier |
| Confirmation arrives twice | Same outcome is delivered repeatedly | Make confirmation processing idempotent |
| User retries from another device | Concurrent intent may overlap | Enforce uniqueness and business limits in durable storage |

Treat this table as a prompt to inspect the actual provider contract. Some systems support a client-supplied idempotency key; others require search or support intervention after ambiguity. Never promise exactly-once effects based only on local code. [DDIA, PDF pp. 364–367, 682–684; Hard Parts, PDF pp. 369–371]

## 15. Scaling and performance decisions

Estimate before optimizing. State expected daily and peak traffic, request mix, data size, payload size, concurrency, and latency target. Separate **throughput** (work per time), **latency** (time per action), and **availability** (ability to serve). A fast average can still conceal a bad tail experience. [Xu, vol. 1, PDF pp. 57–62; Fundamentals, PDF pp. 159–161]

Investigate bottlenecks in this order:

1. Measure the complete user journey and identify the slowest stage.
2. Check query plans, network calls, serialization, and unnecessary repeated work.
3. Improve algorithms, indexes, batching, and payloads where evidence supports it.
4. Add caching or asynchronous work if the resulting consistency model is acceptable.
5. Scale a component independently only when its workload and ownership justify the added boundary.

Capacity planning should include a failure margin, but avoid inventing a massive scale target to justify infrastructure. Document the next threshold and an upgrade path instead of building the final topology immediately.

## 16. Professional maintenance and change management

Maintenance is a design concern from the first release. A professional team keeps the system understandable, observable, and recoverable as requirements evolve. This includes documenting why consequential choices were made, keeping dependencies current, and making routine changes safe to deploy. [Google, PDF pp. 39–44; Fundamentals, PDF pp. 700–701]

### Daily engineering habits

- Keep changes small enough to review against one behavioral goal.
- Review data ownership, authorization, retries, and observability whenever a workflow changes.
- Prefer names that expose domain meaning over generic names such as `manager` or `utils`.
- Add a behavioral test for a consequential bug so the failure cannot silently return.
- Update documentation when a decision, contract, or operator action changes.
- Verify the deployed result, especially when build-time and runtime environments differ.

### Safe release practice

Before release, know how to detect failure and how to stop or reverse the change. For a schema migration, determine whether old and new code can coexist. Prefer an **expand, migrate, contract** sequence when a breaking schema change cannot be deployed atomically. Back up data and test restoration; a backup that has never been restored is an unverified recovery plan.

For an incident, establish the actual user impact and current state, stop further harm, preserve identifiers and logs, restore service, then analyze causes. Separate immediate remediation from systemic correction. The review should produce a change in code, monitoring, process, or documentation that addresses the failure mode.

### When to refactor

Refactor when repeated changes reveal an unstable boundary, duplication causes divergent behavior, tests are difficult because responsibilities are tangled, or incident analysis exposes hidden coupling. Preserve behavior with tests while changing structure. Avoid speculative refactoring that delays an urgent correctness fix without reducing its risk.

## 17. What to avoid

| Temptation | Why it fails | Better question |
| --- | --- | --- |
| Choose a trendy architecture first | It answers a technology question before the user problem | Which invariant or measured pressure requires it? |
| Build for hypothetical millions of users | Complexity and operating costs arrive immediately | What current threshold will trigger the next step? |
| Assume ACID means all races are solved | Isolation varies and cross-system workflows remain uncertain | Which invariant is enforced under concurrent requests? |
| Retry every failure | A timed-out mutation may already have succeeded | Can the prior result be identified and queried? |
| Add a queue without an owner | Work can be duplicated, delayed, or stuck | Who owns state, deduplication, and recovery? |
| Treat cached data as current | Stale decisions can mislead or cause harm | What is its freshness and permitted use? |
| Split services to improve code organization | Network boundaries add coordination without fixing poor modules | Can clear module boundaries solve the problem locally? |
| Hide complexity behind a broad abstraction | The difficult behavior remains but becomes less visible | Does this abstraction encode a real stable concept? |
| Test functions one by one | Tests mirror implementation and miss user guarantees | Which behavior must hold across components? |
| Claim perfect reliability | Partial failures and human error remain | How do we detect, recover, and explain failures? |

These cautions are a synthesis of the books' recurring emphasis on scope, tradeoffs, partial failure, explicit boundaries, and behavior-focused verification. [Xu, vol. 1, PDF pp. 55–62; DDIA, PDF pp. 310–327, 364–367, 682–684; Clean Architecture, PDF pp. 216–229; Google, PDF pp. 396–398]

## 18. Templates for future projects

### One-page architecture brief

```text
Outcome and target user:
First complete workflow:
Current scale and expected next threshold:
Three most important quality characteristics:
Non-negotiable invariants:
Authoritative data sources:
External dependencies and their failure modes:
Security and authorization boundaries:
Two credible approaches considered:
Chosen approach and reason:
Risks, unknowns, and experiments:
How we will know the design works:
When this design must be revisited:
```

### Architecture decision record

```text
Title: A decision, expressed as an action
Status: Proposed | Accepted | Superseded
Context: The requirement, constraints, and evidence
Decision: The chosen approach and its scope
Alternatives: Other credible choices and why they lost
Consequences: Benefits, costs, failure modes, operational work
Verification: Test, metric, or experiment that will check the decision
Revisit trigger: A measurable event or changed assumption
Owner and date: Who can explain or review the decision
```

### Critical workflow specification

```text
Actor and authorization:
User's intended action:
Inputs and validation:
Invariant before and after:
Durable operation ID:
State transitions:
External calls and their timeouts:
Behavior on duplicate request:
Behavior on ambiguous result:
Reconciliation and manual repair:
User-visible states:
Logs, metrics, and alerts:
Tests proving the guarantees:
```

## 19. Source map and limits

| Source | Most useful contribution to this guide | Directly examined PDF pages |
| --- | --- | --- |
| Robert C. Martin, *Clean Architecture* | Business rules, dependency direction, adapters, and the cost of boundaries | 204–219, 228–229 |
| Martin Kleppmann, *Designing Data-Intensive Applications* | Isolation, concurrency anomalies, partial failures, operation IDs, and end-to-end correctness | 310–327, 364–367, 682–684 |
| Mark Richards and Neal Ford, *Fundamentals of Software Architecture*, 2nd ed. | Architecture characteristics, modular monoliths, and ADRs | 39–42, 159–161, 305–309, 700–701 |
| Raju Gandhi et al., *Head First Software Architecture* | Prioritizing characteristics, tradeoffs, and recording decisions | 145–148, 204, 239–244 |
| Neal Ford et al., *Software Architecture: The Hard Parts* | Service granularity, data ownership, distributed transactions, workflow states, and tradeoff analysis | 215–218, 280–285, 369–371, 417–422 |
| Titus Winters et al., *Software Engineering at Google* | Long-term costs, early defect detection, test size, and behavior-focused tests | 39–44, 355–358, 396–398 |
| Alex Xu, *System Design Interview: An Insider's Guide* (two files) | Clarifying scope, explicit assumptions, focused investigation, and failure cases | First file 55–62, 204–207; second file 42–49, 160–161 |

The source books explain more than this guide covers. Their examples and prescriptions should be checked against the requirements, technology, team, and operating conditions of any future project. The goal is a disciplined decision process, not a fixed architecture recipe.
