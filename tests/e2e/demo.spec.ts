import { expect, test } from "@playwright/test";

test("a signed-out visitor can change the plan and inspect the original review without leaving the sample", async ({ page, context, baseURL }) => {
  const outsideSample: string[] = [];
  const allowedPaths = new Set(["/", "/demo", "/favicon.ico"]);
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === baseURL && request.method() === "GET" &&
        (allowedPaths.has(url.pathname) || url.pathname.startsWith("/_next/"))) {
      await route.continue();
      return;
    }
    outsideSample.push(request.method() + " " + url.pathname);
    await route.abort();
  });

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByRole("link", { name: "Try the sample walkthrough" }).click();
  await expect(page).toHaveURL(baseURL + "/demo");
  await expect(page.getByText("Sample walkthrough · no real funds")).toBeVisible();

  await page.getByRole("button", { name: "Open saved review" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Check the saved review" })).toBeFocused();
  await expect(page.getByText("Terms recorded. Take a closer look.")).toBeVisible();
  const savedDebit = page.getByText("100.50 USDC", { exact: true });
  await expect(savedDebit).toBeVisible();
  await page.getByRole("button", { name: "Edit sample plan" }).press("Enter");

  const allowance = page.getByRole("region", { name: "Sample investing allowance" });
  const rent = page.getByRole("textbox", { name: "Rent due (USDC)" });
  await expect(allowance.getByText("300.00 USDC", { exact: true })).toBeVisible();
  await rent.fill("12345678901234567890.123");
  await expect(rent).toHaveValue("12345678901234567890.123");
  await rent.press("Enter");
  await expect(page.getByRole("region", { name: "Change a commitment" }).getByRole("alert")).toContainText("up to two decimal places");
  await expect(allowance.getByText("300.00 USDC", { exact: true })).toBeVisible();

  await rent.fill("1500");
  await rent.press("Enter");
  await expect(allowance.getByText("0.00 USDC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open saved review" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Your plan has changed." })).toBeVisible();
  await expect(savedDebit).toBeVisible();
  await expect(page.getByText(/The saved review used the earlier 300.00 USDC allowance/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^(approve|execute|retry)/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await page.getByRole("button", { name: "Expired quote" }).press("Enter");
  await expect(page.getByRole("heading", { name: "The review window has ended." })).toBeVisible();
  await page.getByRole("button", { name: "Rejected quote" }).press("Enter");
  await expect(page.getByText("No order to approve or track.")).toBeVisible();
  await page.getByRole("button", { name: "Uncertain order" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Outcome not confirmed" })).toBeVisible();
  await page.getByRole("button", { name: "Verified receipt" }).press("Enter");
  await expect(page.getByText("Cash verified manually", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Restart walkthrough" }).press("Enter");
  await expect(rent).toHaveValue("1200");
  await expect(allowance.getByText("300.00 USDC", { exact: true })).toBeVisible();
  expect(await context.cookies()).toEqual([]);
  expect(outsideSample).toEqual([]);
});

for (const width of [360, 1280]) {
  test(`the sample plan comes before optional examples and receipts offer a return path at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/demo");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to walkthrough" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("textbox", { name: "Rent due (USDC)" })).toBeFocused();

    await page.getByRole("button", { name: "Verified receipt" }).press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "When cash is verified" })).toBeFocused();
    await page.getByRole("button", { name: "Back to sample plan" }).press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Invest with room for what’s due." })).toBeFocused();
    await page.getByRole("button", { name: "Verified receipt" }).press("Enter");
    await expect(page.getByText("Cash verified manually", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
