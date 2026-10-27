// Ad set creation: promoted_object (pixel event or page) and the Advantage+
// audience default, proven against the offline stub through the CLI so the
// dry-run output, the request body and the write gate order are all covered.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const agentRoot = path.join(__dirname, "..");
const cli = path.join(agentRoot, "src/index.js");
const stub = path.join(__dirname, "fixtures/graph-api-stub.js");
const { buildPromotedObject, PROMOTED_EVENT_TYPES } = require("../src/api-client");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-adset-"));
const stubLog = path.join(tempDir, "requests.jsonl");
const env = {
  ...process.env,
  META_ADS_ACCESS_TOKEN: "EAAfaketoken1234567890",
  META_ADS_APP_SECRET: "fakeappsecret0987654321",
  META_ADS_ACCOUNT_ID: "act_123",
  META_ADS_APP_ID: "123456789",
  META_ADS_AUDIT_LOG_PATH: path.join(tempDir, "audit.jsonl"),
  META_ADS_STUB_LOG: stubLog,
  // Never the member's own .env: a writes flag or budget cap there would
  // change what this test asserts and roll every self-update back.
  META_ADS_IGNORE_ENV_FILES: "1",
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${JSON.stringify(stub)}`.trim(),
};
delete env.META_ADS_WRITES_ENABLED;
delete env.META_ADS_MAX_DAILY_BUDGET_CENTS;

const base = { campaignId: "c1", name: "Test set", dailyBudget: 10, optimizationGoal: "OFFSITE_CONVERSIONS", targeting: { geo_locations: { countries: ["AU"] } } };
const run = (input, args = [], extraEnv = {}) => spawnSync(process.execPath, [cli, "adsets", "create", JSON.stringify(input), ...args], { encoding: "utf8", env: { ...env, ...extraEnv } });
const requests = () => (fs.existsSync(stubLog) ? fs.readFileSync(stubLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
const dryRunBody = (result) => JSON.parse(result.stdout).request.body;

try {
  // Pure builder: each event type accepted and upper-cased, invalid refused, page path, goal rule.
  for (const type of PROMOTED_EVENT_TYPES) {
    assert.deepStrictEqual(buildPromotedObject({ pixelId: "987", customEventType: type.toLowerCase() }), { pixel_id: "987", custom_event_type: type });
  }
  assert.throws(() => buildPromotedObject({ pixelId: "987", customEventType: "VIEW_CONTENT" }), /customEventType "VIEW_CONTENT" is not supported; use one of PURCHASE, LEAD/);
  assert.throws(() => buildPromotedObject({ pixelId: "987" }), /pixelId needs customEventType/);
  assert.throws(() => buildPromotedObject({ customEventType: "LEAD" }), /customEventType needs pixelId/);
  assert.deepStrictEqual(buildPromotedObject({ pageId: "555" }), { page_id: "555" });
  assert.throws(() => buildPromotedObject({ optimizationGoal: "OFFSITE_CONVERSIONS" }), /needs a promoted object/);
  assert.throws(() => buildPromotedObject({ optimizationGoal: "LEAD_GENERATION" }), /needs a promoted object/);
  assert.strictEqual(buildPromotedObject({ optimizationGoal: "LINK_CLICKS" }), null);
  assert.deepStrictEqual(buildPromotedObject({ promotedObject: { pixel_id: "1", custom_event_type: "PURCHASE" } }), { pixel_id: "1", custom_event_type: "PURCHASE" });

  // Dry run with a pixel event: body shows promoted_object and advantage_audience 1, no write call.
  fs.writeFileSync(stubLog, "");
  const purchase = run({ ...base, pixelId: "987", customEventType: "PURCHASE" }, ["--dry-run"]);
  assert.strictEqual(purchase.status, 0, purchase.stderr);
  const purchaseBody = dryRunBody(purchase);
  assert.deepStrictEqual(purchaseBody.promoted_object, { pixel_id: "987", custom_event_type: "PURCHASE" });
  assert.deepStrictEqual(purchaseBody.targeting.targeting_automation, { advantage_audience: 1 });
  assert.strictEqual(purchaseBody.daily_budget, 1000);
  assert.strictEqual(purchaseBody.status, "PAUSED");
  assert.match(purchase.stderr, /dry run \(nothing sent\)/);
  assert.match(purchase.stderr, /"promoted_object":\{"pixel_id":"987","custom_event_type":"PURCHASE"\}/);
  assert.match(purchase.stderr, /"advantage_audience":1/);
  assert.strictEqual(requests().filter((request) => request.method !== "GET").length, 0, "a dry run never reaches a write endpoint");

  // Each event type is accepted and lands in the body (dry run).
  for (const type of PROMOTED_EVENT_TYPES) {
    const result = run({ ...base, pixelId: "987", customEventType: type }, ["--dry-run"]);
    assert.strictEqual(result.status, 0, `${type}: ${result.stderr}`);
    assert.strictEqual(dryRunBody(result).promoted_object.custom_event_type, type);
  }

  // Invalid event type is refused before any request, even with writes on.
  fs.writeFileSync(stubLog, "");
  const invalid = run({ ...base, pixelId: "987", customEventType: "VIEW_CONTENT" }, [], { META_ADS_WRITES_ENABLED: "true" });
  assert.notStrictEqual(invalid.status, 0);
  assert.match(invalid.stderr, /customEventType "VIEW_CONTENT" is not supported/);
  assert.strictEqual(requests().length, 0, "an invalid event type sends nothing");

  // A conversion goal without a promoted object is refused with guidance.
  const missing = run(base, ["--dry-run"]);
  assert.notStrictEqual(missing.status, 0);
  assert.match(missing.stderr, /OFFSITE_CONVERSIONS needs a promoted object\. Pass pixelId plus customEventType/);

  // Page path for lead forms.
  const page = run({ ...base, optimizationGoal: "LEAD_GENERATION", pageId: "555", destinationType: "ON_AD" }, ["--dry-run"]);
  assert.strictEqual(page.status, 0, page.stderr);
  assert.deepStrictEqual(dryRunBody(page).promoted_object, { page_id: "555" });

  // Advantage+ audience override to 0; an explicit targeting_automation block wins.
  const off = run({ ...base, pixelId: "987", customEventType: "LEAD", advantageAudience: false }, ["--dry-run"]);
  assert.deepStrictEqual(dryRunBody(off).targeting.targeting_automation, { advantage_audience: 0 });
  const explicit = run({ ...base, pixelId: "987", customEventType: "LEAD", targeting: { targeting_automation: { advantage_audience: 0 } } }, ["--dry-run"]);
  assert.deepStrictEqual(dryRunBody(explicit).targeting.targeting_automation, { advantage_audience: 0 });

  // Gate order is unchanged: writes off refuses a live create before the budget check or any request.
  fs.writeFileSync(stubLog, "");
  const gated = run({ ...base, pixelId: "987", customEventType: "PURCHASE" });
  assert.notStrictEqual(gated.status, 0);
  assert.match(gated.stderr, /writes disabled: set META_ADS_WRITES_ENABLED=true/);
  assert.strictEqual(requests().length, 0);
  // Budget cap still applies with writes on, before any request.
  const overCap = run({ ...base, dailyBudget: 50, pixelId: "987", customEventType: "PURCHASE" }, [], { META_ADS_WRITES_ENABLED: "true" });
  assert.notStrictEqual(overCap.status, 0);
  assert.match(overCap.stderr, /exceeds the default cap of 2000 cents/);
  assert.strictEqual(requests().length, 0);
  // Live create through the stub sends promoted_object and advantage_audience in the POST body.
  const live = run({ ...base, pixelId: "987", customEventType: "PURCHASE" }, [], { META_ADS_WRITES_ENABLED: "true" });
  assert.strictEqual(live.status, 0, live.stderr);
  const post = requests().find((request) => request.method === "POST" && request.path === "/act_123/adsets");
  assert.ok(post, "the live create posts to the ad sets edge");
  assert.deepStrictEqual(post.body.promoted_object, { pixel_id: "987", custom_event_type: "PURCHASE" });
  assert.deepStrictEqual(post.body.targeting.targeting_automation, { advantage_audience: 1 });

  // doctor readiness notes mention both.
  const doctor = JSON.parse(spawnSync(process.execPath, [cli, "doctor"], { encoding: "utf8", env }).stdout);
  assert.ok(doctor.guardrails.some((line) => /promoted_object/.test(line)), "doctor mentions promoted_object");
  assert.ok(doctor.guardrails.some((line) => /advantage_audience to 1/.test(line)), "doctor mentions the advantage_audience default");
  assert.strictEqual(doctor.adSetDefaults.advantageAudience, 1);

  console.log("adset-promoted-object.test.js passed");
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
