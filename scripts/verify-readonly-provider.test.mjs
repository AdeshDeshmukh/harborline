import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyPublicProvider } from "./verify-readonly-provider.ts";

const id = "0016331d-4c93-4dcd-87d5-12e0ff36f931";
// Synthetic contract fixtures; these values are not live proof.
const asset = {
  id, symbol: "SPYX", name: "Synthetic stock listing", address: "SyntheticMint",
  chain: "solana", venue: "defi", type: "spot", asset_class: "stock",
  status: "active", tradeable: true, order_types: ["market"],
};
const rules = [
  { venue: "defi", countries: [{ code: "CA", name: "Canada" }] },
  { asset_class: "stock", countries: [{ code: "US", name: "United States" }] },
  { product_type: "spot", countries: [{ code: "GB", name: "United Kingdom" }] },
  { venue: "cefi", countries: [{ code: "FR", name: "France" }] },
];

function responses(catalog = { data: [asset], pagination: { next_cursor: null } }, restrictions = { data: rules }) {
  return async (url, options) => {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    if (url === "https://api.truemarkets.co/v1/gateway/assets?asset_class=stock&venue=defi&product_type=spot") return Response.json(catalog);
    assert.equal(url, "https://api.truemarkets.co/v1/gateway/assets/restrictions");
    return Response.json(restrictions);
  };
}

test("returns exact candidate and union of all matching restrictions, without eligibility claim", async () => {
  const result = await verifyPublicProvider(id, responses());
  assert.equal(result.candidate.id, id);
  assert.equal(result.candidate.address, "SyntheticMint");
  assert.deepEqual(result.restricted_country_codes, ["CA", "GB", "US"]);
  assert.equal(result.eligibility, "unverified");
  assert.equal(result.quote_currency, null);
});

test("rejects missing, ambiguous and unsuitable listings instead of silently choosing another", async () => {
  for (const data of [[], [asset, asset], [{ ...asset, status: "sell_only" }],
    [{ ...asset, chain: "base" }], [{ ...asset, tradeable: false }],
    [{ ...asset, type: "perp" }], [{ ...asset, venue: "cefi" }],
    [{ ...asset, asset_class: "crypto" }], [{ ...asset, order_types: ["limit"] }]]) {
    await assert.rejects(verifyPublicProvider(id, responses({ data })), /candidate/i);
  }
});

test("rejects malformed or partial catalog and unfamiliar restriction selectors", async () => {
  for (const catalog of [{}, { data: [null] }, { data: [{ ...asset, address: null }] },
    { data: [asset], pagination: { next_cursor: "more" } }]) {
    await assert.rejects(verifyPublicProvider(id, responses(catalog)), /catalog/i);
  }
  for (const data of [[{ chain: "solana", countries: [] }],
    [{ constructor: "stock", countries: [] }],
    [{ asset_class: "future-category", countries: [] }],
    [{ asset_class: "stock", countries: [{ code: "usa", name: "US" }] }],
    [{ asset_class: "stock", venue: "defi", countries: [] }],
    [{ asset_class: "stock", countries: null }]]) {
    await assert.rejects(verifyPublicProvider(id, responses(undefined, { data })), /restriction/i);
  }
});

test("does not expose upstream bodies, exception text or URLs on failure", async () => {
  for (const [fetcher, message] of [
    [async () => { throw new Error("secret-token-in-error"); }, "Public provider request failed (network or timeout)"],
    [async () => new Response("secret-upstream-body", { status: 503 }), "Public provider request failed (HTTP 503)"],
    [async () => new Response("not json secret", { status: 200 }), "Public provider returned invalid JSON"],
  ]) {
    await assert.rejects(verifyPublicProvider(id, fetcher), (error) => {
      assert.doesNotMatch(error.message, /secret|token|https:/);
      assert.match(error.message, /public provider/i);
      assert.equal(error.message, message);
      return true;
    });
  }
});

test("invalid asset IDs fail before any network request", async () => {
  await assert.rejects(verifyPublicProvider("not-an-id", async () => {
    assert.fail("invalid input must not contact provider");
  }), /asset ID/i);
});

test("CLI failures exit nonzero without producing a success record", () => {
  const script = fileURLToPath(new URL("./verify-readonly-provider.ts", import.meta.url));
  const result = spawnSync(process.execPath, [script, "invalid"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /asset ID/);
});
