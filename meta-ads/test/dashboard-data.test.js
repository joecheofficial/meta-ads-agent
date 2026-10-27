// The dashboard data layer against invented fixture files: every section with
// data, every section with an empty cache, the CLI command, and a redaction
// sweep that plants the fake credentials inside the cache to prove they never
// come out. Runs only inside the harness copy (it writes data/*.json).
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const agentRoot = path.join(__dirname, "..");
const cli = path.join(agentRoot, "src/index.js");
const stub = path.join(__dirname, "fixtures/graph-api-stub.js");
// Fixtures only: never read the agent's or the workspace's real .env (a live
// writes flag or budget cap there would change what this test asserts).
process.env.META_ADS_IGNORE_ENV_FILES = "1";
// Nor the shell's: a member who exported the writes flag or a budget cap would
// otherwise fail the self-test and have every self-update rolled back.
delete process.env.META_ADS_WRITES_ENABLED;
delete process.env.META_ADS_MAX_DAILY_BUDGET_CENTS;
const data = require("../src/dashboard-data");

const FAKE_TOKEN = "EAAfaketoken1234567890";
const FAKE_SECRET = "fakeappsecret0987654321";
const inTempCopy = fs.realpathSync(agentRoot).startsWith(fs.realpathSync(os.tmpdir()));

function day(offset) {
  const d = new Date(Date.UTC(2026, 8, 30));
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function dailyRow(offset, spend, purchases, clicks, impressions) {
  return {
    spend: String(spend), impressions: String(impressions), reach: String(Math.round(impressions * 0.8)), clicks: String(clicks),
    ctr: String((clicks / impressions) * 100), cpm: String((spend / impressions) * 1000), frequency: "1.25",
    actions: [{ action_type: "link_click", value: String(clicks) }, { action_type: "offsite_conversion.fb_pixel_purchase", value: String(purchases) }, { action_type: "purchase", value: String(purchases) }],
    action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: String(purchases * 97) }],
    date_start: day(offset), date_stop: day(offset),
  };
}

function levelRow(level, ids, spend, purchases, clicks, impressions) {
  return { ...dailyRow(0, spend, purchases, clicks, impressions), ...ids, date_start: day(29), date_stop: day(0), level };
}

function writeFixtures(dir, { withDaily = true, plantSecret = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, value) => fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(value, null, 2));
  write("account", { id: "act_123", name: "Fixture Bakery", account_status: 1, currency: "USD", timezone_name: "Asia/Makassar", amount_spent: "123400", balance: "5000", spend_cap: "0" });
  write("campaigns", [
    { id: "c1", name: "Workshop Sept", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_SALES", daily_budget: "1500", updated_time: "2026-09-20T10:00:00+0000" },
    { id: "c2", name: "Retargeting", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_SALES", daily_budget: "1000", updated_time: "2026-09-10T10:00:00+0000" },
    { id: "c3", name: "Old Brand Push", status: "ACTIVE", effective_status: "ACTIVE", objective: "OUTCOME_AWARENESS", daily_budget: "800", updated_time: "2026-09-01T10:00:00+0000" },
    { id: "c4", name: "Paused Test", status: "PAUSED", effective_status: "PAUSED", objective: "OUTCOME_LEADS", lifetime_budget: "20000", created_time: "2026-08-01T10:00:00+0000" },
  ]);
  write("adsets", [
    { id: "as1", name: "Cold AU", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "c1", daily_budget: "1500", optimization_goal: "OFFSITE_CONVERSIONS", start_time: "2026-09-01T00:00:00+0000" },
    { id: "as2", name: "Warm list", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "c2", daily_budget: "1000", optimization_goal: "OFFSITE_CONVERSIONS" },
    { id: "as3", name: "Broad interests", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "c3", daily_budget: "800", optimization_goal: "REACH" },
  ]);
  write("ads", [
    { id: "ad1", name: "Hook A", status: "ACTIVE", effective_status: "ACTIVE", campaign_id: "c1", adset_id: "as1", creative: { id: "cr1", title: plantSecret ? `Less busy work ${FAKE_TOKEN}` : "Less busy work" } },
    { id: "ad2", name: "Hook B", status: "PAUSED", effective_status: "ADSET_PAUSED", campaign_id: "c1", adset_id: "as1" },
  ]);
  write("insights", [{ ...dailyRow(0, 1230, 24, 600, 48000), date_start: day(29), date_stop: day(0) }]);
  if (withDaily) {
    const daily = [];
    for (let offset = 27; offset >= 0; offset--) daily.push(dailyRow(offset, offset >= 7 ? 40 : 50, offset >= 7 ? 1 : 2, offset >= 7 ? 20 : 30, 1600));
    write("insights-daily", daily);
  }
  write("insights-campaigns", [
    levelRow("campaign", { campaign_id: "c1", campaign_name: "Workshop Sept" }, 420, 14, 300, 20000),
    levelRow("campaign", { campaign_id: "c2", campaign_name: "Retargeting" }, 300, 15, 200, 8000),
    levelRow("campaign", { campaign_id: "c3", campaign_name: "Old Brand Push" }, 240, 0, 40, 30000),
  ]);
  write("insights-adsets", [
    levelRow("adset", { campaign_id: "c1", campaign_name: "Workshop Sept", adset_id: "as1", adset_name: "Cold AU" }, 420, 14, 300, 20000),
    levelRow("adset", { campaign_id: "c2", campaign_name: "Retargeting", adset_id: "as2", adset_name: "Warm list" }, 300, 15, 200, 8000),
    levelRow("adset", { campaign_id: "c3", campaign_name: "Old Brand Push", adset_id: "as3", adset_name: "Broad interests" }, 240, 0, 40, 30000),
  ]);
  write("insights-ads", [levelRow("ad", { campaign_id: "c1", adset_id: "as1", ad_id: "ad1", ad_name: "Hook A" }, 420, 14, 300, 20000)]);
  write("last-sync", { timestamp: new Date(Date.now() - 2 * 3600000).toISOString(), errors: plantSecret ? { pixels: `Meta API Error: token ${FAKE_TOKEN} appsecret_proof=${FAKE_SECRET}` } : {} });
  const opt = path.join(dir, "optimization", "act_123");
  fs.mkdirSync(opt, { recursive: true });
  fs.writeFileSync(path.join(opt, "latest-report.json"), JSON.stringify({
    status: "observation_with_warnings",
    accountMetrics: { spend: 350, purchases: 7, cpa: 50, roas: 1.94 },
    warnings: [{ code: "measurement_unverified" }],
    proposals: [
      { id: "measurement-reconciliation", title: "Reconcile measurement before optimization", objectId: "act_123", evidence: { periods: { recent: { since: day(7), until: day(1) } }, campaigns: [{ id: "c1", name: "Workshop Sept", metrics: { spend: 350, purchases: 7, cpa: 50, roas: 1.94 } }] }, counterevidence: "Platform attribution and payment receipts differ.", proposedAction: "Reconcile." },
      { id: "event-alignment-review", title: "Review purchase versus checkout optimization", objectId: "as1", evidence: { currentEvent: "INITIATE_CHECKOUT", desiredEvent: "PURCHASE" }, counterevidence: "Checkout optimization can be intentional." },
      { id: "creative-control-ad1", title: "Prepare a comparable creative experiment", objectId: "ad1", evidence: { candidate: { id: "ad1", name: "Hook A", metrics: { spend: 350, clicks: 210, purchases: 7 } }, otherAds: [{ id: "ad2" }] }, counterevidence: "Unequal exposure." },
    ],
  }));
}

function assertNoLeak(label, text) {
  assert.ok(!text.includes(FAKE_TOKEN), `${label}: access token leaked\n${text.slice(0, 500)}`);
  assert.ok(!text.includes(FAKE_SECRET), `${label}: app secret leaked`);
  assert.doesNotMatch(text, /access_token=(?!<redacted>)/, `${label}: access_token value printed`);
}

const environment = {
  ...process.env,
  META_ADS_ACCESS_TOKEN: FAKE_TOKEN,
  META_ADS_APP_SECRET: FAKE_SECRET,
  META_ADS_ACCOUNT_ID: "act_123",
  META_ADS_APP_ID: "123456789",
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${JSON.stringify(stub)}`.trim(),
};
delete environment.META_ADS_WRITES_ENABLED;
delete environment.META_ADS_MAX_DAILY_BUDGET_CENTS;
const runCli = (args, extraEnv = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...environment, ...extraEnv } });

async function sectionsWithFixtures() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-dashboard-data-"));
  try {
    writeFixtures(dir);
    process.env.META_ADS_ACCESS_TOKEN = FAKE_TOKEN;
    process.env.META_ADS_APP_SECRET = FAKE_SECRET;
    process.env.META_ADS_ACCOUNT_ID = "act_123";
    process.env.META_ADS_APP_ID = "123456789";

    // overview: 7-day window with a comparison and a trend.
    const overview = await data.overview({ dataDir: dir, period: "7d" });
    assert.strictEqual(overview.ok, true);
    assert.strictEqual(overview.empty, false);
    assert.strictEqual(overview.account.name, "Fixture Bakery");
    assert.strictEqual(overview.account.currency, "USD");
    assert.strictEqual(overview.period.source, "daily");
    assert.strictEqual(overview.period.days, 7);
    assert.ok(overview.period.comparison, "7d has a comparison window");
    assert.strictEqual(overview.trend.length, 7);
    const spend = overview.metrics.find((m) => m.key === "spend");
    assert.strictEqual(spend.value, 350);
    assert.strictEqual(spend.previous, 280);
    assert.strictEqual(spend.changePct, 25);
    const results = overview.metrics.find((m) => m.key === "results");
    assert.strictEqual(results.label, "Purchases");
    assert.strictEqual(results.value, 14);
    assert.strictEqual(results.previous, 7);
    const cpr = overview.metrics.find((m) => m.key === "costPerResult");
    assert.strictEqual(cpr.value, 25);
    assert.strictEqual(cpr.previous, 40);
    assert.strictEqual(cpr.direction, "better", "a lower cost per result reads as better");
    assert.ok(overview.metrics.find((m) => m.key === "roas"), "ROAS present when purchase values exist");
    assert.strictEqual(overview.metrics.find((m) => m.key === "roas").value, Number(((14 * 97) / 350).toFixed(2)));
    assert.deepStrictEqual(overview.resultsByType.map((row) => row.key), ["purchase", "link_click"]);
    assert.strictEqual(overview.campaigns.active, 3);

    // 30d window covers only 28 fixture days; month window exists.
    const month = await data.overview({ dataDir: dir, period: "month" });
    assert.strictEqual(month.period.label, "This month");
    assert.ok(month.period.days >= 1);
    const fallback = await data.overview({ dataDir: dir, period: "bogus" });
    assert.strictEqual(fallback.period.key, "7d", "unknown period falls back to the default");

    // ads: every level joined to its numbers.
    const ads = await data.ads({ dataDir: dir });
    assert.strictEqual(ads.rows.length, 4 + 3 + 2);
    const c1 = ads.rows.find((row) => row.level === "campaign" && row.id === "c1");
    assert.strictEqual(c1.spend, 420);
    assert.strictEqual(c1.results, 14);
    assert.strictEqual(c1.costPerResult, 30);
    assert.strictEqual(c1.budget.type, "daily");
    assert.strictEqual(c1.budget.cents, 1500);
    assert.strictEqual(c1.status, "Active");
    assert.strictEqual(c1.lastChange, "2026-09-20T10:00:00+0000");
    const ad1 = ads.rows.find((row) => row.level === "ad" && row.id === "ad1");
    assert.strictEqual(ad1.campaignName, "Workshop Sept");
    assert.strictEqual(ad1.adsetName, "Cold AU");
    assert.strictEqual(ad1.results, 14);
    const ad2 = ads.rows.find((row) => row.level === "ad" && row.id === "ad2");
    assert.strictEqual(ad2.status, "Paused (ad set)");
    assert.strictEqual(ad2.spend, 0);
    assert.strictEqual(ad2.hasInsights, false);
    const c4 = ads.rows.find((row) => row.id === "c4");
    assert.strictEqual(c4.budget.type, "lifetime");

    // improvements: planner cards and rule cards, grouped, dry-run commands only.
    const improvements = await data.improvements({ dataDir: dir });
    assert.strictEqual(improvements.ok, true);
    const groups = Object.fromEntries(improvements.groups.map((group) => [group.key, group.cards]));
    assert.ok(groups.stop.some((card) => card.objectId === "c3"), "the campaign with spend and no results is a Stop card");
    const stop = groups.stop.find((card) => card.objectId === "c3");
    assert.match(stop.command, /^node src\/index\.js campaigns pause c3 --dry-run$/);
    assert.ok(stop.evidence.some((row) => row.label.startsWith("Spent") && row.value === 240));
    assert.ok(groups.scale.some((card) => card.objectId === "c2" && card.source === "rules"), "the cheap-results campaign is a Scale card");
    assert.ok(groups.scale.some((card) => card.objectId === "as2" && card.source === "rules"), "and so is its ad set");
    const scale = groups.scale.find((card) => card.source === "rules");
    assert.match(scale.command, /budget (c1|as1|c2|as2) \d+ --dry-run$/);
    const proposedCents = Number(scale.command.match(/budget \S+ (\d+)/)[1]);
    assert.ok(proposedCents <= 2000, `proposed budget ${proposedCents} must respect the default cap`);
    assert.ok(groups.watch.some((card) => card.id === "planner-measurement-reconciliation"));
    assert.ok(groups.fix.some((card) => card.id === "planner-event-alignment-review"));
    assert.ok(groups.scale.some((card) => card.id === "planner-creative-control-ad1"));
    for (const card of improvements.groups.flatMap((group) => group.cards)) {
      assert.strictEqual(card.appliesWrite, false);
      if (card.command) assert.ok(/--dry-run|--example|targeting search/.test(card.command), `${card.id}: command must be a dry run or a read: ${card.command}`);
      assert.ok(Array.isArray(card.evidence) && card.evidence.length > 0, `${card.id} has evidence`);
      assert.ok(card.nextStep && card.what && card.why, `${card.id} has owner text`);
      assert.ok(!JSON.stringify(card).includes("\u2014"), `${card.id}: no em dashes`);
    }
    assert.strictEqual(improvements.writesEnabled, false);
    assert.strictEqual(improvements.budgetCap.limitCents, 2000);

    // summary: every sentence has backing numbers.
    const summary = await data.summary({ dataDir: dir, period: "7d" });
    assert.strictEqual(summary.ok, true);
    assert.match(summary.headline, /\$350\.00 spent, 14 purchases at \$25\.00 each\./);
    const keys = summary.sentences.map((sentence) => sentence.key);
    for (const key of ["spent", "got", "cost", "sales", "changed", "working", "wasting", "next", "cap", "refreshed", "writes"]) {
      assert.ok(keys.includes(key), `summary has a ${key} sentence (${keys.join(",")})`);
    }
    for (const sentence of summary.sentences) {
      assert.strictEqual(typeof sentence.text, "string");
      assert.ok(sentence.numbers && typeof sentence.numbers === "object", `${sentence.key} carries its numbers`);
      assert.ok(!sentence.text.includes("\u2014"), "no em dashes in owner text");
    }
    assert.match(summary.sentences.find((s) => s.key === "spent").text, /25% more than/);
    assert.match(summary.sentences.find((s) => s.key === "wasting").text, /Old Brand Push/);
    assert.match(summary.sentences.find((s) => s.key === "cap").text, /\$20\.00/);
    assert.match(summary.sentences.find((s) => s.key === "writes").text, /OFF/);
    assert.strictEqual(summary.controls.stale, false);

    // freshness
    const fresh = await data.freshness({ dataDir: dir });
    assert.strictEqual(fresh.hasData, true);
    assert.strictEqual(fresh.hasDailySeries, true);
    assert.strictEqual(fresh.credentialsConfigured, true);
    assert.strictEqual(fresh.refreshPossible, true);
    assert.strictEqual(fresh.stale, false);
    assert.strictEqual(fresh.files["insights-daily"], true);

    // Without the daily series the overview still answers, from the cached total.
    const noDaily = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-dashboard-nodaily-"));
    try {
      writeFixtures(noDaily, { withDaily: false });
      const cached = await data.overview({ dataDir: noDaily, period: "7d" });
      assert.strictEqual(cached.period.source, "cached_total");
      assert.strictEqual(cached.period.comparison, null);
      assert.ok(cached.period.note);
      assert.strictEqual(cached.metrics.find((m) => m.key === "spend").value, 1230);
      assert.strictEqual(cached.trend.length, 0);
    } finally {
      fs.rmSync(noDaily, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.META_ADS_ACCESS_TOKEN;
    delete process.env.META_ADS_APP_SECRET;
  }
}

async function sectionsWithoutData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-dashboard-empty-"));
  try {
    for (const name of data.SECTIONS) {
      const result = await data.section(name, { dataDir: dir });
      assert.strictEqual(result.ok, true, `${name} answers ok on an empty cache`);
      if (name === "freshness") {
        assert.strictEqual(result.hasData, false);
        assert.strictEqual(result.lastSync, null);
        assert.strictEqual(result.stale, true);
      } else {
        assert.strictEqual(result.empty, true, `${name} reports an empty state`);
        assert.match(result.message, /Refresh|credentials/i, `${name} tells the owner what to do`);
        assert.strictEqual(typeof result.credentialsConfigured, "boolean");
      }
    }
    const all = await data.section("all", { dataDir: dir });
    assert.deepStrictEqual(Object.keys(all), data.SECTIONS);
    await assert.rejects(() => data.section("nope", { dataDir: dir }), /Unknown dashboard section/);
    // Half-empty cache: an account but no insights still gives a helpful state, no crash.
    fs.writeFileSync(path.join(dir, "account.json"), JSON.stringify({ id: "act_123", name: "Fixture Bakery", currency: "EUR" }));
    const overview = await data.overview({ dataDir: dir });
    assert.strictEqual(overview.empty, true);
    assert.strictEqual(overview.account.currency, "EUR");
    // Corrupt file: ignored, not fatal.
    fs.writeFileSync(path.join(dir, "campaigns.json"), "{not json");
    const ads = await data.ads({ dataDir: dir });
    assert.strictEqual(ads.empty, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function cliAndRedaction() {
  if (!inTempCopy) return;
  const dataDir = path.join(agentRoot, "data");
  // Empty cache first: the CLI answers with the empty state, exit 0.
  for (const file of fs.readdirSync(dataDir)) fs.rmSync(path.join(dataDir, file), { recursive: true, force: true });
  const emptySummary = runCli(["dashboard-data", "summary"]);
  assert.strictEqual(emptySummary.status, 0, emptySummary.stderr);
  assert.match(emptySummary.stdout, /No synced data yet|credentials/);
  const emptyJson = runCli(["dashboard-data", "overview", "--json"]);
  assert.strictEqual(JSON.parse(emptyJson.stdout).empty, true);
  const bad = runCli(["dashboard-data", "nope"]);
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /Usage: dashboard-data/);

  // Plant the fake credentials inside cached files: nothing printed may carry them.
  writeFixtures(dataDir, { plantSecret: true });
  for (const section of [...data.SECTIONS, "all"]) {
    const result = runCli(["dashboard-data", section, "--json", "--period", "14d"]);
    assert.strictEqual(result.status, 0, `${section}: ${result.stderr}`);
    assertNoLeak(`dashboard-data ${section}`, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed && typeof parsed === "object");
    if (section === "overview") assert.strictEqual(parsed.period.days, 14);
  }
  const text = runCli(["dashboard-data", "summary"]);
  assert.strictEqual(text.status, 0);
  assertNoLeak("dashboard-data summary (text)", text.stdout);
  assert.match(text.stdout, /^\$[\d.]+ spent/m);
  const fresh = JSON.parse(runCli(["dashboard-data", "freshness", "--json"]).stdout);
  assert.match(JSON.stringify(fresh.syncErrors), /<redacted>/, "cached sync errors come out redacted");
  // The ads section carries the planted creative title, redacted.
  const ads = JSON.parse(runCli(["dashboard-data", "ads", "--json"]).stdout);
  assert.ok(ads.rows.length > 0);

  // refresh without credentials fails plainly and touches nothing.
  const before = fs.readFileSync(path.join(dataDir, "last-sync.json"), "utf8");
  const blocked = spawnSync(process.execPath, [cli, "refresh"], { encoding: "utf8", env: { ...environment, META_ADS_ACCESS_TOKEN: "", META_ADS_APP_SECRET: "" } });
  assert.notStrictEqual(blocked.status, 0);
  assert.match(blocked.stderr, /Refresh needs Meta credentials\. Missing: META_ADS_ACCESS_TOKEN, META_ADS_APP_SECRET/);
  assert.strictEqual(fs.readFileSync(path.join(dataDir, "last-sync.json"), "utf8"), before, "a blocked refresh writes nothing");
  // refresh through the stub: the sources the stub answers are cached, the rest are reported, nothing leaks.
  const refreshed = runCli(["refresh"]);
  assertNoLeak("refresh", `${refreshed.stdout}\n${refreshed.stderr}`);
  assert.match(refreshed.stdout, /Synced: 2 campaigns, 2 ad sets, 2 ads/);
  assert.notStrictEqual(refreshed.status, 0, "the stub cannot answer audiences/pixels, so refresh reports a partial sync");
  assert.match(refreshed.stderr, /Sync failed for audiences/);
  const lastSync = JSON.parse(fs.readFileSync(path.join(dataDir, "last-sync.json"), "utf8"));
  assert.ok(lastSync.synced.includes("insights-daily"));
  assert.ok(Object.keys(lastSync.errors).includes("pixels"));
  assertNoLeak("last-sync.json", JSON.stringify(lastSync));
  for (const name of ["ads", "insights-daily", "insights-campaigns", "insights-adsets", "insights-ads"]) {
    assert.ok(fs.existsSync(path.join(dataDir, `${name}.json`)), `refresh writes ${name}.json`);
    assertNoLeak(`data/${name}.json`, fs.readFileSync(path.join(dataDir, `${name}.json`), "utf8"));
  }
  // The programmatic refresh wrapper reports the same outcome, redacted.
  const wrapped = await data.refresh({ env: { META_ADS_ACCESS_TOKEN: FAKE_TOKEN, META_ADS_APP_SECRET: FAKE_SECRET, META_ADS_ACCOUNT_ID: "act_123", META_ADS_APP_ID: "123456789", NODE_OPTIONS: environment.NODE_OPTIONS } });
  assert.strictEqual(wrapped.ran, true);
  assert.strictEqual(wrapped.ok, false);
  assertNoLeak("data.refresh()", JSON.stringify(wrapped));
  assert.match(wrapped.output, /Synced: 2 campaigns/);
  // After a refresh the overview reads the stub's single insight row.
  const overview = JSON.parse(runCli(["dashboard-data", "overview", "--json"]).stdout);
  assert.strictEqual(overview.ok, true);
  assert.strictEqual(overview.account.name, "Fake Business Account");
  for (const file of fs.readdirSync(dataDir)) fs.rmSync(path.join(dataDir, file), { recursive: true, force: true });
}

async function run() {
  await sectionsWithFixtures();
  await sectionsWithoutData();
  await cliAndRedaction();
}

run()
  .then(() => console.log("dashboard-data.test.js passed"))
  .catch((error) => { console.error(error); process.exit(1); });
