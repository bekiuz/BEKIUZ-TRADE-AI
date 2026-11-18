import assert from "node:assert/strict";
import worker from "../src/index.js";

const health = await worker.fetch(
  new Request("https://local.test/api/health"),
  { AI: { run: async () => ({ response: "{}" }) } }
);
assert.equal(health.status, 200);
const healthData = await health.json();
assert.equal(healthData.ok, true);
assert.equal(healthData.aiAvailable, true);

const home = await worker.fetch(
  new Request("https://local.test/"),
  {}
);
assert.equal(home.status, 200);
assert.match(await home.text(), /BEKIUZ TRADE AI/);

const invalidAnalysis = await worker.fetch(
  new Request("https://local.test/api/analyze", {
    method: "POST",
    body: new FormData()
  }),
  {}
);
assert.equal(invalidAnalysis.status, 400);
console.log("Smoke checks passed.");
