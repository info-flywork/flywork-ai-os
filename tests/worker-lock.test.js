// @vitest-environment node
import { loadEnvConfig } from "@next/env";
import { afterAll, describe, expect, it } from "vitest";
import { holdWorkerLock } from "@/server/automation/singleton";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const testKey = 748222;

describe.skipIf(!databaseUrl)("worker kilidi", () => {
  const releases = [];

  afterAll(async () => {
    for (const release of releases) {
      await release();
    }
  });

  it("aynı anahtarda ikinci süreci almaz ve sonra bırakır", async () => {
    const first = await holdWorkerLock(databaseUrl, testKey);
    expect(first).not.toBeNull();
    releases.push(first.release);
    const second = await holdWorkerLock(databaseUrl, testKey);
    expect(second).toBeNull();
    await first.release();
    releases.pop();
    const third = await holdWorkerLock(databaseUrl, testKey);
    expect(third).not.toBeNull();
    await third.release();
  });
});
