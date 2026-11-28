# Public sample walkthrough

Open `/demo` from the Harborline home page to try the commitment-aware review with fictional data. The demo starts with 2,000 USDC of sample cash, 1,200 USDC of rent, a 500 USDC buffer, and 300 USDC available to invest.

1. Open the saved review. Its fictional 100 USDC request has a 0.50 USDC fee.
2. Return to the plan and select **Try 1,500 USDC rent**. The cash breakdown updates and the investing allowance falls to zero. You can also enter and save your own sample rent.
3. Reopen the review to compare the earlier 300 USDC allowance with the current zero allowance. The original terms remain visible below.
4. Open **Explore quote and order examples** for an expired or rejected quote, an uncertain order, and a verified receipt. The two order records are independent examples.
5. Restart the walkthrough to restore the original plan.

The route renders fixed examples and keeps edits in the browser until restart or refresh. It needs no login, database, Gateway credentials, or funds. The existing private trading routes are separate from this walkthrough.

## Run the browser regression

```sh
pnpm build
pnpm exec playwright install --only-shell chromium
pnpm test:browser
```

The test starts the production build on local port 3290 in demo mode with a fresh Chromium context. It follows the signed-out journey at 360px and rejects requests outside the demo, including all mutation requests. The existing CI job runs the same test after its production build.
