// Runs every CLI command that prints a Graph API response as a child process
// against the offline Graph stub (test/fixtures/graph-api-stub.js) and proves
// that neither stdout nor stderr ever contains the fake access token, the fake
// app secret, or a paging URL. Also covers the audit log, the data/ cache and
// the ad set budget fields.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const FAKE_TOKEN = "EAAfaketoken1234567890";
const FAKE_SECRET = "fakeappsecret0987654321";
const agentRoot = path.join(__dirname, "..");
const cli = path.join(agentRoot, "src/index.js");
const stub = path.join(__dirname, "fixtures/graph-api-stub.js");

function assertNoLeak(label, text) {
  assert.ok(!text.includes(FAKE_TOKEN), `${label}: access token leaked\n${text}`);
  assert.ok(!text.includes(FAKE_SECRET), `${label}: app secret leaked\n${text}`);
  assert.ok(!text.includes(encodeURIComponent(FAKE_TOKEN)), `${label}: encoded token leaked`);
  // Paging links are URLs carrying a cursor; a redacted request URL quoted in an error message is allowed.
  assert.doesNotMatch(text, /https:\/\/graph\.facebook\.com\/[^\s"']*[?&](after|before)=/, `${label}: paging URL printed\n${text}`);
  assert.doesNotMatch(text, /access_token=(?!<redacted>)/, `${label}: access_token value printed`);
  assert.doesNotMatch(text, /appsecret_proof=(?!<redacted>)/, `${label}: appsecret_proof value printed`);
}

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-redaction-cli-"));
  const auditPath = path.join(tempDir, "audit.jsonl");
  const stubLog = path.join(tempDir, "requests.jsonl");
  const env = {
    ...process.env,
    META_ADS_ACCESS_TOKEN: FAKE_TOKEN,
    META_ADS_APP_SECRET: FAKE_SECRET,
    META_ADS_ACCOUNT_ID: "act_123",
    META_ADS_APP_ID: "123456789",
    META_ADS_AUDIT_LOG_PATH: auditPath,
    META_ADS_STUB_LOG: stubLog,
    // Never the member's own .env: a writes flag or budget cap there would
    // change what this test asserts and roll every self-update back.
    META_ADS_IGNORE_ENV_FILES: "1",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${JSON.stringify(stub)}`.trim(),
  };
  delete env.META_ADS_WRITES_ENABLED;
  const runCli = (args, extraEnv = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...env, ...extraEnv } });

  // dashboard and sync write data/*.json next to src/. Only exercise them when
  // this test runs from the harness copy under the temp dir, never over real cache files.
  const inTempCopy = fs.realpathSync(agentRoot).startsWith(fs.realpathSync(os.tmpdir()));

  const commands = [
    { args: ["doctor"], expectOk: true },
    { args: ["campaigns", "list"], expectOk: true },
    { args: ["campaigns", "get", "c1"], expectOk: true },
    { args: ["adsets", "list"], expectOk: true },
    { args: ["adsets", "list", "c1"], expectOk: true },
    { args: ["ads", "list"], expectOk: true },
    { args: ["ads", "list", "as1"], expectOk: true },
    { args: ["insights"], expectOk: true },
    { args: ["insights", "campaign", "c1"], expectOk: true },
    { args: ["account"], expectOk: true },
    { args: ["targeting", "search", "ai"], expectOk: true },
    { args: ["campaigns", "get", "does-not-exist"], expectOk: false, expectError: /Meta API Error: .*<redacted>.*\(code 100\)/ },
    // Each of these hits a path the stub answers with a 400 whose message carries the token.
    { args: ["audiences", "list"], expectOk: false },
    { args: ["pixels", "list"], expectOk: false },
    { args: ["rules", "list"], expectOk: false },
    { args: ["experiments", "list"], expectOk: false },
    { args: ["images", "list"], expectOk: false },
    { args: ["insights", "adset", "as1"], expectOk: false },
    { args: ["leads", "forms", "page-1"], expectOk: false },
    ...(inTempCopy ? [{ args: ["dashboard"], expectOk: true }, { args: ["sync"], expectOk: false }] : []),
  ];

  try {
    for (const command of commands) {
      const result = runCli(command.args);
      const label = command.args.join(" ");
      const combined = `${result.stdout}\n${result.stderr}`;
      assertNoLeak(label, combined);
      if (command.expectOk) assert.strictEqual(result.status, 0, `${label} failed: ${result.stderr}`);
      else assert.notStrictEqual(result.status, 0, `${label} should fail`);
      if (command.expectError) assert.match(result.stderr, command.expectError, label);
    }

    // doctor: live checks pass through the stub and the integrity block is present.
    const doctor = JSON.parse(runCli(["doctor"]).stdout);
    assert.strictEqual(doctor.status, "ready_for_live_api", JSON.stringify(doctor.liveChecks));
    assert.ok(doctor.integrity && typeof doctor.integrity.ok === "boolean" && Array.isArray(doctor.integrity.changed), "doctor reports integrity");
    assert.strictEqual(doctor.writes, "off");
    assert.deepStrictEqual(doctor.account, { id: "act_123", name: "Fake Business Account", business: "Fake Business Co", accountStatus: 1 });
    assert.strictEqual(JSON.parse(runCli(["doctor"], { META_ADS_WRITES_ENABLED: "true" }).stdout).writes, "on");
    // The account read is one call (reused for the identity), never a second one.
    fs.writeFileSync(stubLog, "");
    runCli(["doctor"]);
    const doctorRequests = fs.readFileSync(stubLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.strictEqual(doctorRequests.filter((request) => request.path === "/act_123").length, 2, "doctor keeps its two account reads (identity + details), no extra call");
    assert.ok(doctorRequests[0].params.fields.split(",").includes("business"));
    // Offline doctor: no credentials means no account identity and no live call.
    // Harness copy only: a real install has a .env that readiness would see.
    if (inTempCopy) {
      const offline = spawnSync(process.execPath, [cli, "doctor"], { encoding: "utf8", env: { ...env, META_ADS_ACCESS_TOKEN: "", META_ADS_APP_SECRET: "", META_ADS_STUB_LOG: path.join(tempDir, "offline.jsonl") } });
      const offlineReport = JSON.parse(offline.stdout);
      assert.strictEqual(offlineReport.status, "offline_copilot_only");
      assert.strictEqual(offlineReport.account, null);
      assert.strictEqual(fs.existsSync(path.join(tempDir, "offline.jsonl")), false, "offline doctor makes no network call");
    }
    assert.deepStrictEqual(doctor.env.map((item) => Object.keys(item).sort()), doctor.env.map(() => ["name", "present", "source"]), "doctor never prints env values");

    // campaigns list: both pages merged, paging reduced to cursors.
    const campaigns = JSON.parse(runCli(["campaigns", "list"]).stdout);
    assert.deepStrictEqual(campaigns.data.map((row) => row.id), ["c1", "c2"]);
    assert.strictEqual(campaigns.paging.next, undefined);
    assert.match(campaigns.paging.previous, /^<redacted url; next page cursor paging\.cursors\.before=QVFIUmN1cnNvcjI>$/);
    assert.deepStrictEqual(campaigns.paging.cursors, { before: "QVFIUmN1cnNvcjI", after: "QVFIUmN1cnNvcjM" });

    // adsets list: budget fields requested and printed.
    fs.writeFileSync(stubLog, "");
    const adsets = JSON.parse(runCli(["adsets", "list"]).stdout);
    assert.strictEqual(adsets.data[0].daily_budget, "1500");
    assert.strictEqual(adsets.data[0].lifetime_budget, "0");
    assert.strictEqual(adsets.data[0].budget_remaining, "900");
    assert.strictEqual(adsets.data[0].bid_strategy, "LOWEST_COST_WITHOUT_CAP");
    assert.strictEqual(adsets.data[1].lifetime_budget, "50000");
    const requests = fs.readFileSync(stubLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const requestedFields = requests[0].params.fields.split(",");
    for (const field of ["daily_budget", "lifetime_budget", "budget_remaining", "bid_strategy"]) {
      assert.ok(requestedFields.includes(field), `adsets list must request ${field}`);
    }
    const singleRequest = runCli(["targeting", "search", "ai"]);
    const search = JSON.parse(singleRequest.stdout);
    assert.match(search.paging.next, /^<redacted url; next page cursor paging\.cursors\.after=B>$/);

    // Audit log, dry run: no credential in the entry, dryRun marked, request recorded.
    fs.rmSync(auditPath, { force: true });
    const dryRun = runCli(["campaigns", "budget", "c1", "500", "--dry-run"]);
    assert.strictEqual(dryRun.status, 0, dryRun.stderr);
    assertNoLeak("campaigns budget --dry-run", `${dryRun.stdout}\n${dryRun.stderr}`);
    assert.match(dryRun.stdout, /"dryRun": true/);
    assert.match(dryRun.stdout, /"daily_budget": 500/);
    let audit = fs.readFileSync(auditPath, "utf8");
    assertNoLeak("audit log (dry run)", audit);
    const dryEntry = JSON.parse(audit.trim().split("\n").pop());
    assert.strictEqual(dryEntry.result.dryRun, true);
    assert.strictEqual(dryEntry.action, "POST /c1");

    // Audit log, live write (stub echoes the request URL with the token).
    fs.rmSync(auditPath, { force: true });
    const live = runCli(["campaigns", "pause", "c1", "--confirm", "CONFIRM PAUSE c1"], { META_ADS_WRITES_ENABLED: "true" });
    assert.strictEqual(live.status, 0, live.stderr);
    assertNoLeak("campaigns pause (live, stub)", `${live.stdout}\n${live.stderr}`);
    assert.match(live.stdout, /"debug_request": "https:\/\/graph\.facebook\.com\/v25\.0\/c1\?access_token=<redacted>"/);
    audit = fs.readFileSync(auditPath, "utf8");
    assertNoLeak("audit log (live write)", audit);
    assert.match(audit, /"debug_request":"https:\/\/graph\.facebook\.com\/v25\.0\/c1\?access_token=<redacted>"/);

    // data/ cache written by dashboard and sync (harness copy only).
    if (inTempCopy) {
      const dataDir = path.join(agentRoot, "data");
      for (const name of fs.readdirSync(dataDir).filter((file) => file.endsWith(".json"))) {
        assertNoLeak(`data/${name}`, fs.readFileSync(path.join(dataDir, name), "utf8"));
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log("redaction-cli.test.js passed"))
  .catch((error) => { console.error(error); process.exit(1); });
