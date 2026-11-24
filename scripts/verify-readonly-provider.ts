const origin = "https://api.truemarkets.co/v1/gateway";
const catalogUrl = `${origin}/assets?asset_class=stock&venue=defi&product_type=spot`;
const restrictionsUrl = `${origin}/assets/restrictions`;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256;
}

async function readPublicJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Public provider request failed (network or timeout)");
  }
  if (!response.ok) {
    throw new Error(`Public provider request failed (HTTP ${response.status})`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Public provider returned invalid JSON");
  }
}

function catalogRows(value: unknown): Record<string, unknown>[] {
  if (!record(value) || !Array.isArray(value.data)) {
    throw new Error("Invalid public catalog shape");
  }
  if (value.pagination !== undefined &&
    (!record(value.pagination) || value.pagination.next_cursor !== null)) {
    throw new Error("Incomplete public catalog pagination");
  }
  return value.data.map((row: unknown) => {
    if (!record(row) ||
      !["id", "symbol", "name", "address", "chain", "venue", "type", "asset_class", "status"].every((key) => text(row[key])) ||
      typeof row.tradeable !== "boolean" || !Array.isArray(row.order_types) ||
      !row.order_types.every(text)) {
      throw new Error("Invalid public catalog listing");
    }
    return row;
  });
}

function matchingCountries(value: unknown, candidate: Record<string, unknown>): string[] {
  if (!record(value) || !Array.isArray(value.data)) {
    throw new Error("Invalid public restrictions shape");
  }
  const countries = new Set<string>();
  const selectors: Record<string, string> = {
    venue: "venue", product_type: "type", asset_class: "asset_class",
  };
  const values: Record<string, string[]> = {
    venue: ["cefi", "defi"], product_type: ["spot", "perp"], asset_class: ["crypto", "stock"],
  };
  for (const rule of value.data) {
    if (!record(rule) || Object.keys(rule).some((key) => key !== "countries" && !Object.hasOwn(selectors, key))) {
      throw new Error("Unknown public restriction selector");
    }
    const keys = Object.keys(rule).filter((key) => Object.hasOwn(selectors, key));
    if (keys.length !== 1 || !text(rule[keys[0]]) ||
      !values[keys[0]].includes(rule[keys[0]] as string) || !Array.isArray(rule.countries)) {
      throw new Error("Invalid public restriction rule");
    }
    for (const country of rule.countries) {
      if (!record(country) || typeof country.code !== "string" ||
        !/^[A-Z]{2}$/.test(country.code) || !text(country.name)) {
        throw new Error("Invalid public restriction country");
      }
      if (rule[keys[0]] === candidate[selectors[keys[0]]]) countries.add(country.code);
    }
  }
  return [...countries].sort();
}

export async function verifyPublicProvider(
  assetId: string,
  fetcher: typeof fetch = fetch,
) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(assetId)) {
    throw new Error("A valid asset ID is required");
  }
  const rows = catalogRows(await readPublicJson(catalogUrl, fetcher));
  const matches = rows.filter((row) => row.id === assetId);
  const candidate = matches[0];
  if (matches.length !== 1 || candidate.chain !== "solana" || candidate.venue !== "defi" ||
    candidate.type !== "spot" || candidate.asset_class !== "stock" ||
    candidate.status !== "active" || candidate.tradeable !== true ||
    !(candidate.order_types as string[]).includes("market")) {
    throw new Error("Candidate is missing, ambiguous or unsuitable for the proposed route");
  }
  const restrictions = await readPublicJson(restrictionsUrl, fetcher);
  const restrictedCountries = matchingCountries(restrictions, candidate);
  return {
    observed_at: new Date().toISOString(),
    environment: "local-public-read",
    sources: [catalogUrl, restrictionsUrl],
    catalog_count: rows.length,
    candidate: Object.fromEntries(
      ["id", "symbol", "name", "address", "chain", "venue", "type", "asset_class", "status", "tradeable", "order_types"]
        .map((key) => [key, candidate[key]]),
    ),
    restricted_country_codes: restrictedCountries,
    eligibility: "unverified",
    quote_currency: null,
    execution: "not_attempted",
  };
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/verify-readonly-provider.ts <asset-id>");
    console.log(JSON.stringify(await verifyPublicProvider(process.argv[2]), null, 2));
  } catch (error) {
    // Only this module's fixed messages are emitted; upstream exceptions/bodies
    // never reach this boundary. No credentials or environment files are read.
    console.error(error instanceof Error ? error.message : "Public provider check failed");
    process.exitCode = 1;
  }
}
