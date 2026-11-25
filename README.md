# Harborline

**Invest with room to breathe.**

Harborline is being built for freelancers who receive USDC. The planned
workflow explains how much remains after their stated commitments and a chosen
buffer, then lets an eligible pilot user explicitly approve a tokenized-asset
investment through the True Markets Gateway.

The project is being built for the True Markets “Build the Next Fintech App”
challenge. It is currently in the foundation stage; the interface shown today
does not represent a completed or generally available financial product.

## Project status

The local application currently serves a static introduction page. Authentication,
database persistence, cash calculations, Gateway integration, the public sample
journey, deployment, and live trade evidence are planned and are not implemented.

Development follows the [32-slice delivery roadmap](./harborline-product-and-architecture-plan.md#18-pr-delivery-roadmap-labels-and-progress-tracking).
Local work may be ahead of the published repository; until the foundation is
merged, cloning `main` will not provide the application described here.

## Product principles

- A wallet balance alone does not describe money available to invest.
- Every deduction in the allowance calculation should be visible.
- A zero allowance is a useful result.
- Preparing an order is separate from approving it.
- Ambiguous provider outcomes remain visibly unresolved until reconciled.
- Demo data and live evidence must always be clearly distinguished.

## Technology choices

| Area | Available in the scaffold | Planned |
| --- | --- | --- |
| Application | Next.js 16.4.6, React 19.3.0, TypeScript 5.9.3 | Modular account, planning, and order features |
| Styling | Tailwind CSS 4.3.3 with PostCSS | Accessible form and display primitives |
| Quality | ESLint, TypeScript checks, production build | Vitest and Playwright with feature implementation |
| Identity and data | None | Supabase Auth, PostgreSQL, Drizzle |
| Financial behavior | None | decimal.js and True Markets Gateway |
| Hosting and scheduled work | None | Vercel and Supabase Cron |

Dependencies are added only when the corresponding module is implemented.

## Local setup

Requirements:

- Node.js 24 as the deployment target (`.nvmrc`); the package accepts Node 24–26
- pnpm 11.8.0

Use the project directory containing `package.json`. If using nvm, run `nvm use`
there first. The baseline has been verified locally on Node 26.5.0; Node 24 CI
verification is scheduled in HL-04. No global Node or pnpm upgrade is required
by the application itself; select the declared versions with your preferred
version manager.

Install exactly the locked dependencies and start the development server:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The introduction page requires **no environment variables, external accounts,
database, wallet, or deposit**. `.env.example` documents future configuration;
none of its variables is consumed by the current application. Copy it to
`.env.local` only when implementing a feature that requires configuration.
Variable names and requirements will be finalized with their consuming module.

`.env.local` is ignored by Git; `.env.example` is tracked as documentation.
Never put real credentials, wallet signer material, API keys, or customer
financial information in committed files. A `false` value in an example file
is not an implemented trading control.

## Verification

```bash
pnpm lint
pnpm exec next typegen
pnpm typecheck
pnpm build
```

Feature-specific unit, integration, contract, and browser test commands will be
added with the features they verify. `next typegen` creates Next.js declarations
on a fresh checkout before the standalone TypeScript check; the build also
generates these declarations.

To serve the production output after a successful build:

```bash
pnpm start
```

Development and production compilation currently use webpack. Tailwind runs
through PostCSS in both paths. See the [foundation decisions](./harborline-product-and-architecture-plan.md#74-foundation-decisions-and-current-implementation)
for the rationale, limits, and revisit conditions.

## Documentation

- [Product and architecture plan](./harborline-product-and-architecture-plan.md)
- [System design reading summary](./system-design-books-summary.md)
- [Explicit approval state machine and fixture boundary](./docs/order-approval.md)

## Current boundaries

The application contains no trading endpoint or signer. Before implementing
live execution, verify organization access, eligibility, geography, signing,
debit semantics, recovery, and the return path. The proposed allowance uses
user-entered commitments; it does not reserve funds or guarantee suitability.

## License

Licensed under the [Apache License 2.0](./LICENSE).
