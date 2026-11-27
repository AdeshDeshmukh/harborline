import "server-only";

import { sampleActivity } from "../orders/sample-activity.server";
import { createSampleQuoteRejection, createSampleReviewScreen } from "../orders/sample-review.server";

export function createDemoFixtures() {
  const now = new Date("2026-11-25T12:00:05.000Z");

  return {
    current: createSampleReviewScreen("current", now),
    changed: createSampleReviewScreen("changed", now),
    expired: createSampleReviewScreen("expired", now),
    rejected: createSampleQuoteRejection(now),
    unknown: sampleActivity("unknown"),
    verified: sampleActivity("verified"),
  };
}
