import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { runManualCommand } from "../scripts/record-manual-reconciliation.mjs";
test("the actual CLI stays disabled and does not read a supplied file", () => {
  const result = spawnSync(process.execPath, ["scripts/record-manual-reconciliation.mjs", "--proof-file", "/nonexistent/private-evidence"], { encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("disabled");
  expect(result.stderr).not.toContain("ENOENT");
});
test("an injected fixture maintenance command reads evidence and exposes only verification identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harborline-manual-"));
  try {
    const file = join(dir, "proof.json");
    await writeFile(file, JSON.stringify({ requestKey: "fixture" }));
    const result = await runManualCommand(["--proof-file", file], { source: "contract_fixture", run: async (input) => { expect(input).toEqual({ requestKey: "fixture" }); return { id: "11111111-1111-4111-8111-111111111111", intentId: "22222222-2222-4222-8222-222222222222", method: "manual", source: "contract_fixture", slotReleased: true, private: "secret" }; } });
    expect(result.exitCode).toBe(0);
    expect(JSON.stringify(result)).not.toContain("secret");
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("provider mode cannot reach an injected maintenance action", async () => {
  let calls = 0;
  const result = await runManualCommand(["--proof-file", "/missing"], { source: "provider", run: async () => { calls++; } });
  expect(result.exitCode).toBe(1);
  expect(calls).toBe(0);
});
test("a fixture proof FIFO is rejected without blocking the command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harborline-proof-fifo-"));
  try {
    const file = join(dir, "pipe");
    expect(spawnSync("mkfifo", [file]).status).toBe(0);
    const code = "import {runManualCommand} from './scripts/record-manual-reconciliation.mjs'; const r=await runManualCommand(['--proof-file',process.argv[1]],{source:'contract_fixture',run:async()=>({id:'11111111-1111-4111-8111-111111111111',method:'manual',source:'contract_fixture',slotReleased:true})});process.exitCode=r.exitCode;";
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code, file], { timeout: 3000, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined();
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
});
