const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Fake Meta API: records every request and answers the ads listing with the
// ads named in META_ADS_FAKE_ADS (JSON). DELETE answers { success: true }.
const FAKE_FETCH = `
  const fs = require("fs");
  global.fetch = async (url, options = {}) => {
    const method = (options.method || "GET").toUpperCase();
    const u = new URL(url);
    fs.appendFileSync(process.env.META_ADS_REQUEST_LOG, JSON.stringify({ method, path: u.pathname }) + "\\n");
    let body = { success: true };
    if (method === "GET" && u.pathname.endsWith("/ads")) {
      if (!String(u.searchParams.get("effective_status") || "").includes("ARCHIVED")) throw new Error("ads lookup must include ARCHIVED");
      body = { data: JSON.parse(process.env.META_ADS_FAKE_ADS || "[]") };
    }
    if (method === "GET" && u.pathname.endsWith("/adcreatives")) body = { data: [{ id: "555" }, { id: "777" }] };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  };
`;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-creative-delete-"));
  const hook = path.join(dir, "fake-fetch.js");
  fs.writeFileSync(hook, FAKE_FETCH);
  const log = path.join(dir, "requests.log");
  return { dir, hook, log };
}

function runCli(ctx, args, fakeAds = []) {
  const env = {
    ...process.env,
    META_ADS_ACCESS_TOKEN: "test-token",
    META_ADS_ACCOUNT_ID: "act_123",
    META_ADS_WRITES_ENABLED: "true",
    META_ADS_REQUEST_LOG: ctx.log,
    META_ADS_FAKE_ADS: JSON.stringify(fakeAds),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${JSON.stringify(ctx.hook)}`.trim(),
  };
  return spawnSync(process.execPath, [path.join(__dirname, "../src/index.js"), ...args], { encoding: "utf8", env });
}

function requests(ctx) {
  if (!fs.existsSync(ctx.log)) return [];
  return fs.readFileSync(ctx.log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function run() {
  const ctx = setup();
  try {
    // 1. No confirmation phrase: refused before any network call.
    let r = runCli(ctx, ["creatives", "delete", "555"]);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /CONFIRM DELETE 555/);
    assert.deepStrictEqual(requests(ctx), []);

    // 2. Wrong phrase: refused, no network.
    r = runCli(ctx, ["creatives", "delete", "555", "--confirm", "CONFIRM DELETE 556"]);
    assert.notStrictEqual(r.status, 0);
    assert.deepStrictEqual(requests(ctx), []);

    // 3. Dry run: usage check only, no DELETE sent.
    r = runCli(ctx, ["creatives", "delete", "555", "--dry-run"]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /"dryRun": true/);
    assert.ok(requests(ctx).every((q) => q.method === "GET"));
    fs.rmSync(ctx.log, { force: true });

    // 4. Creative still used by an ad: refused, no DELETE.
    r = runCli(ctx, ["creatives", "delete", "555", "--confirm", "CONFIRM DELETE 555"],
      [{ id: "900", name: "Live ad", effective_status: "PAUSED", creative: { id: "555" } }]);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /used by 1 ad\(s\): 900/);
    assert.ok(requests(ctx).every((q) => q.method === "GET"));
    fs.rmSync(ctx.log, { force: true });

    // 5. Unused creative with the right phrase: one DELETE on that creative only.
    r = runCli(ctx, ["creatives", "delete", "555", "--confirm", "CONFIRM DELETE 555"],
      [{ id: "900", name: "Other ad", effective_status: "PAUSED", creative: { id: "777" } }]);
    assert.strictEqual(r.status, 0, r.stderr);
    const deletes = requests(ctx).filter((q) => q.method === "DELETE");
    assert.strictEqual(deletes.length, 1);
    assert.match(deletes[0].path, /\/555$/);
    fs.rmSync(ctx.log, { force: true });

    // 5b. An ad / ad set / campaign ID (digits, but not a creative): refused, no DELETE.
    r = runCli(ctx, ["creatives", "delete", "900", "--confirm", "CONFIRM DELETE 900"],
      [{ id: "900", name: "Some ad", effective_status: "PAUSED", creative: { id: "777" } }]);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /not an ad creative/);
    assert.ok(requests(ctx).every((q) => q.method === "GET"));
    fs.rmSync(ctx.log, { force: true });

    // 6. Non-numeric ID is refused before any network call.
    r = runCli(ctx, ["creatives", "delete", "act_123", "--confirm", "CONFIRM DELETE act_123"]);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /digits only/);
    assert.deepStrictEqual(requests(ctx), []);

    // 7. Writes off: live delete refused.
    const off = spawnSync(process.execPath, [path.join(__dirname, "../src/index.js"), "creatives", "delete", "555", "--confirm", "CONFIRM DELETE 555"], {
      encoding: "utf8",
      env: { ...process.env, META_ADS_ACCESS_TOKEN: "t", META_ADS_ACCOUNT_ID: "act_123", META_ADS_WRITES_ENABLED: "false", META_ADS_REQUEST_LOG: ctx.log, NODE_OPTIONS: `--require=${JSON.stringify(ctx.hook)}` },
    });
    assert.notStrictEqual(off.status, 0);
    assert.ok(requests(ctx).every((q) => q.method === "GET"));
  } finally {
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log("creatives-delete.test.js passed"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
