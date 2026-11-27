import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import DemoPage from "../src/app/demo/page";
import Home from "../src/app/page";
import { createDemoFixtures } from "../src/features/demo/demo-fixtures.server";

vi.mock("server-only", () => ({}));
vi.mock("../src/server/db", () => { throw new Error("The demo imported database infrastructure"); });
vi.mock("../src/features/identity/session.server", () => { throw new Error("The demo imported session infrastructure"); });
vi.mock("../src/integrations/truemarkets/client.server", () => { throw new Error("The demo imported the Gateway client"); });

test("the homepage leads to a public, labeled fictional plan with no private action", () => {
  expect(renderToStaticMarkup(createElement(Home))).toContain('href="/demo"');
  const html = renderToStaticMarkup(createElement(DemoPage));
  expect(html).toContain("Sample walkthrough · no real funds");
  expect(html).toContain("300.00");
  expect(html).toContain("Open saved review");
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(html).not.toMatch(/<form[^>]+action=|href="\/(sign-in|plan|activity)"|\/api\//);
});

test("the fixed views preserve historical terms and distinguish rejection from uncertainty and verification", () => {
  const fixtures = createDemoFixtures();
  expect(fixtures.current).toMatchObject({ sample: true, status: "current", canProceed: false, review: { maximumDebit: "100.5", cash: { commitments: "1200", debitBudget: "300" } } });
  expect(fixtures.changed).toMatchObject({ sample: true, status: "changed_plan", canProceed: false });
  expect(fixtures.changed.review).toEqual(fixtures.current.review);
  expect(fixtures.expired).toMatchObject({ sample: true, status: "expired", canProceed: false });
  expect(fixtures.rejected).toEqual({ kind: "rejected", reason: "quote_only", providerOrderId: null });
  expect(fixtures.unknown).toMatchObject({ sample: true, data: { order: { state: "UNKNOWN", reservationHeld: true, actual: null, settlement: null } } });
  expect(fixtures.verified).toMatchObject({ sample: true, data: { order: { state: "COMPLETE", settlementVerified: true, reservationHeld: false } } });
  expect(fixtures.unknown.data).not.toEqual(fixtures.verified.data);
});
