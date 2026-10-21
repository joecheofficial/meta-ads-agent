"use strict";

// Tests for the shared repo self-updater. The same file runs from the factory
// (builder/tests/) and from each public repo that vendors the script (test/).
// Everything happens in temp folders with a local bare "origin": no network.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const SCRIPT = [
  path.resolve(__dirname, "../../install/lib/repo-self-update.js"),
  path.resolve(__dirname, "../scripts/self-update.js"),
].find(candidate => fs.existsSync(candidate));
assert.ok(SCRIPT, "the self-update script must exist next to this test");
const lib = require(SCRIPT);

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commitArgs = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"];

function commitAll(repo, message) {
  git("-C", repo, "add", "-A");
  git("-C", repo, ...commitArgs, "commit", "-q", "-m", message);
}

function fixture(t, options = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "self update ")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const remote = path.join(base, "origin.git");
  const publisher = path.join(base, "publisher");
  const clone = path.join(base, "member's clone");
  git("init", "-q", "--bare", "--initial-branch=main", remote);
  git("clone", "-q", remote, publisher);
  fs.mkdirSync(path.join(publisher, "scripts"));
  fs.mkdirSync(path.join(publisher, "test"));
  fs.copyFileSync(SCRIPT, path.join(publisher, "scripts/self-update.js"));
  fs.writeFileSync(path.join(publisher, "package.json"), JSON.stringify({ name: "fixture-tool", version: "1.0.0", scripts: { test: "node --test test/selftest.test.js" }, dependencies: {} }, null, 2));
  fs.writeFileSync(path.join(publisher, "test/selftest.test.js"), 'require("node:test")("passes", () => {});\n');
  fs.writeFileSync(path.join(publisher, "README.md"), "v1\n");
  fs.writeFileSync(path.join(publisher, ".env.example"), "TOKEN=\n");
  fs.writeFileSync(path.join(publisher, ".gitignore"), ".env\nconfig.json\ndata/\nruns/\npersonal/\nbrand/\n");
  commitAll(publisher, "feat: initial release");
  git("-C", publisher, "push", "-q", "origin", "main");
  git("clone", "-q", remote, clone);
  // The member's own files: untracked, ignored, never git's business.
  const protectedFiles = {
    ".env": "TOKEN=member-secret\n",
    "config.json": '{"theme":"member"}\n',
    "data/x.json": '{"rows":[1,2,3]}\n',
    "brand/brand.json": '{"name":"Member Co"}\n',
    "personal/notes.md": "mine\n",
    "runs/r1.json": "{}\n",
  };
  for (const [relative, content] of Object.entries(protectedFiles)) {
    fs.mkdirSync(path.dirname(path.join(clone, relative)), { recursive: true });
    fs.writeFileSync(path.join(clone, relative), content);
  }
  const previous = git("-C", clone, "rev-parse", "HEAD");
  if (options.ahead !== false) {
    fs.writeFileSync(path.join(publisher, "README.md"), "v2\n");
    fs.writeFileSync(path.join(publisher, ".env.example"), "TOKEN=\nNEW_SETTING=\n");
    fs.mkdirSync(path.join(publisher, "brand"), { recursive: true });
    fs.mkdirSync(path.join(publisher, "data"), { recursive: true });
    fs.writeFileSync(path.join(publisher, "brand/README.md"), "how brand files work\n");
    fs.writeFileSync(path.join(publisher, "data/.keep"), "");
    git("-C", publisher, "add", "-f", "brand/README.md", "data/.keep");
    commitAll(publisher, "feat: brand folder docs and a new setting");
    fs.writeFileSync(path.join(publisher, "README.md"), "v3\n");
    commitAll(publisher, "fix: readme typo");
    git("-C", publisher, "push", "-q", "origin", "main");
  }
  const remoteHead = git("-C", publisher, "rev-parse", "HEAD");
  const run = (args = [], env = {}) => spawnSync(process.execPath, [path.join(clone, "scripts/self-update.js"), ...args], {
    cwd: clone, encoding: "utf8", timeout: 120000,
    env: { ...process.env, HOME: base, ALLSORTED_AUTO_UPDATE: "", ALLSORTED_LAUNCH_AGENTS_DIR: path.join(base, "LaunchAgents"), ALLSORTED_SELF_UPDATE_NO_LAUNCHCTL: "1", ...env },
  });
  const snapshot = () => Object.fromEntries(Object.keys(protectedFiles).map(relative => [relative, fs.readFileSync(path.join(clone, relative))]));
  const state = () => JSON.parse(fs.readFileSync(path.join(clone, ".allsorted-update.json"), "utf8"));
  return { base, remote, publisher, clone, previous, remoteHead, protectedFiles, run, snapshot, state };
}

test("behind the remote: fast-forward applied and what's new written", t => {
  const f = fixture(t);
  const before = f.snapshot();
  const result = f.run(["--now"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.remoteHead);
  assert.match(result.stdout, /2 new commits on origin\/main/);
  assert.match(result.stdout, /Self-test passed/);
  assert.match(result.stdout, /What's new in fixture-tool/);
  assert.match(result.stdout, /New:\n\s+- brand folder docs and a new setting/);
  assert.match(result.stdout, /Fixes:\n\s+- readme typo/);
  const state = f.state();
  assert.equal(state.auto, true);
  assert.match(state.lastResult, /^updated to [0-9a-f]{7}$/);
  assert.match(state.whatsNew, /What's new in fixture-tool/);
  assert.ok(Number.isFinite(Date.parse(state.lastCheck)));
  assert.ok(Number.isFinite(Date.parse(state.lastUpdate)));
  // Protected files are untouched even though upstream added files beside them.
  assert.deepEqual(f.snapshot(), before);
  assert.equal(fs.readFileSync(path.join(f.clone, "brand/README.md"), "utf8"), "how brand files work\n");
  // The state file and backups stay out of git status via the local exclude file.
  assert.equal(git("-C", f.clone, "status", "--porcelain"), "");
  const exclude = fs.readFileSync(path.join(f.clone, ".git/info/exclude"), "utf8");
  assert.match(exclude, /^\/\.allsorted-update\.json$/m);
  assert.match(exclude, /^\/\.allsorted-backup\/$/m);
});

test("protected files are backed up before the merge and survive it byte for byte", t => {
  const f = fixture(t);
  const before = f.snapshot();
  const result = f.run(["--now"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Backed up 6 protected file\(s\) to \.allsorted-backup\//);
  assert.doesNotMatch(result.stdout, /Restored \d+ protected/);
  const backups = fs.readdirSync(path.join(f.clone, ".allsorted-backup")).filter(name => /^\d{8}-\d{6}$/.test(name));
  assert.equal(backups.length, 1);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.clone, ".allsorted-backup", backups[0], "backup-manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(f.protectedFiles).sort());
  for (const relative of Object.keys(f.protectedFiles)) {
    assert.deepEqual(fs.readFileSync(path.join(f.clone, ".allsorted-backup", backups[0], relative)), before[relative]);
  }
  assert.deepEqual(f.snapshot(), before);
});

test("a dirty tracked file refuses with the file name and how to keep it", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.clone, "README.md"), "my local edit\n");
  const result = f.run(["--now"]);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /these files have local changes: README\.md/);
  assert.match(result.stdout, /git -C ".*" stash/);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.previous);
  assert.equal(fs.readFileSync(path.join(f.clone, "README.md"), "utf8"), "my local edit\n");
  assert.match(f.state().lastResult, /^refused: local changes/);
});

test("a failing self-test rolls back to the previous commit with the backup restored", t => {
  const f = fixture(t);
  // The new release ships a broken self-test that also tramples the member's .env.
  fs.writeFileSync(path.join(f.publisher, "test/selftest.test.js"), 'require("node:fs").writeFileSync(".env", "TOKEN=clobbered\\n"); require("node:test")("fails", () => { throw new Error("broken release"); });\n');
  commitAll(f.publisher, "feat: a broken release");
  git("-C", f.publisher, "push", "-q", "origin", "main");
  const before = f.snapshot();
  const result = f.run(["--now"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /self-test failed/);
  assert.match(result.stdout, /Rolled back, back on [0-9a-f]{7}, 1 protected file\(s\) restored/);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.previous);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(fs.readFileSync(path.join(f.clone, "README.md"), "utf8"), "v1\n");
  assert.match(f.state().lastResult, /^rolled back: self-test failed/);
  assert.equal(f.state().whatsNew, null);
});

test("opt-out skips without fetching, by file and by environment", t => {
  const f = fixture(t);
  const off = f.run(["--off"]);
  assert.equal(off.status, 0, off.stderr);
  assert.match(off.stdout, /Weekly updates are off/);
  assert.equal(f.state().auto, false);
  // Point origin somewhere that does not exist: any fetch would fail loudly.
  git("-C", f.clone, "remote", "set-url", "origin", path.join(f.base, "missing.git"));
  const skipped = f.run([]);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /weekly updates are off \(auto is false/);
  assert.equal(f.state().lastCheck, null);
  const on = f.run(["--on"]);
  assert.equal(on.status, 0, on.stderr);
  assert.equal(f.state().auto, true);
  const byEnv = f.run([], { ALLSORTED_AUTO_UPDATE: "0" });
  assert.equal(byEnv.status, 0, byEnv.stderr);
  assert.match(byEnv.stdout, /ALLSORTED_AUTO_UPDATE=0/);
  assert.equal(f.state().lastCheck, null);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.previous);
});

test("the 7-day throttle skips silently without fetching; --now applies", t => {
  const f = fixture(t);
  const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(path.join(f.clone, ".allsorted-update.json"), JSON.stringify({ auto: true, lastCheck: recent, lastResult: "up to date" }));
  git("-C", f.clone, "remote", "set-url", "origin", path.join(f.base, "missing.git"));
  const skipped = f.run([]);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.equal(skipped.stdout, "");
  assert.equal(f.state().lastCheck, recent);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.previous);
  // Eight days later the plain run is due again.
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(path.join(f.clone, ".allsorted-update.json"), JSON.stringify({ auto: true, lastCheck: old }));
  git("-C", f.clone, "remote", "set-url", "origin", f.remote);
  const applied = f.run([]);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.remoteHead);
});

test("--check only reports and the unreachable origin is one quiet line", t => {
  const f = fixture(t);
  const check = f.run(["--check", "--now"]);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /an update is available \(2 new commits\)/);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.previous);
  git("-C", f.clone, "remote", "set-url", "origin", path.join(f.base, "missing.git"));
  const unreachable = f.run(["--now"]);
  assert.equal(unreachable.status, 0, unreachable.stderr);
  assert.equal(unreachable.stdout.trim().split("\n").length, 1);
  assert.match(unreachable.stdout, /update check skipped \(git fetch failed/);
});

test("--status prints the setting, schedule, last check and result", t => {
  const f = fixture(t, { ahead: false });
  const first = f.run(["--now"]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /fixture-tool is up to date/);
  const status = f.run(["--status"]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /fixture-tool self-update/);
  assert.match(status.stdout, /weekly:\s+on/);
  assert.match(status.stdout, /scheduled:\s+no/);
  assert.match(status.stdout, /last check:\s+\d{4}-/);
  assert.match(status.stdout, /last result:\s+up to date at [0-9a-f]{7}/);
  assert.match(status.stdout, /next check:\s+\d{4}-/);
});

test("--register writes a weekly launchd job and --unregister removes it", t => {
  const f = fixture(t, { ahead: false });
  const env = { ALLSORTED_SELF_UPDATE_PLATFORM: "darwin" };
  const registered = f.run(["--register"], env);
  assert.equal(registered.status, 0, registered.stdout + registered.stderr);
  assert.match(registered.stdout, /Weekly updates: once a week/);
  assert.match(registered.stdout, /Turn off:\s+node ".*self-update\.js" --off/);
  assert.match(registered.stdout, /Weekly update job installed: launchd com\.allsorted\.self-update\./);
  assert.match(registered.stdout, /Remove it with: node ".*self-update\.js" --unregister/);
  const plists = fs.readdirSync(path.join(f.base, "LaunchAgents"));
  assert.equal(plists.length, 1);
  const plist = fs.readFileSync(path.join(f.base, "LaunchAgents", plists[0]), "utf8");
  assert.match(plist, /<key>Weekday<\/key><integer>1<\/integer>/);
  assert.match(plist, /<key>RunAtLoad<\/key><false\/>/);
  assert.ok(plist.includes(path.join(f.clone, "scripts/self-update.js").replace(/&/g, "&amp;")));
  const status = f.run(["--status"], env);
  assert.match(status.stdout, /scheduled:\s+yes \(launchd/);
  const removed = f.run(["--unregister"], env);
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(fs.readdirSync(path.join(f.base, "LaunchAgents")), []);
});

test("a package vendored deep inside a larger repository is left alone", t => {
  const f = fixture(t);
  // Move the package two folders down inside the clone: tools/vendor/<package>.
  const nested = path.join(f.clone, "tools", "vendor", "fixture-tool");
  fs.mkdirSync(nested, { recursive: true });
  for (const name of ["scripts", "package.json", "test"]) fs.renameSync(path.join(f.clone, name), path.join(nested, name));
  const script = path.join(nested, "scripts/self-update.js");
  for (const args of [["--now"], ["--register"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: f.clone, encoding: "utf8", env: { ...process.env, HOME: f.base, ALLSORTED_LAUNCH_AGENTS_DIR: path.join(f.base, "LaunchAgents"), ALLSORTED_SELF_UPDATE_NO_LAUNCHCTL: "1", ALLSORTED_SELF_UPDATE_PLATFORM: "darwin" } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /sits inside a larger repository/);
  }
  assert.equal(fs.existsSync(path.join(f.base, "LaunchAgents")), false);
  assert.equal(fs.existsSync(path.join(f.clone, ".allsorted-update.json")), false);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.previous);
  assert.equal(lib.dedicatedClone("/repo", "/repo"), true);
  assert.equal(lib.dedicatedClone("/repo", "/repo/meta-ads"), true);
  assert.equal(lib.dedicatedClone("/repo", "/repo/agents/meta-ads"), false);
  assert.equal(lib.dedicatedClone("/repo", "/elsewhere"), false);
});

// Rebuild the publisher's whole history with the same trees under a new author,
// the way a project rewrites published history, then force-push it.
function rewriteHistory(publisher) {
  const commits = git("-C", publisher, "rev-list", "--reverse", "HEAD").split("\n").filter(Boolean);
  let parent = null;
  for (const commit of commits) {
    const tree = git("-C", publisher, "rev-parse", `${commit}^{tree}`);
    const message = git("-C", publisher, "log", "-1", "--format=%B", commit);
    const args = ["-C", publisher, "commit-tree", tree, "-m", message];
    if (parent) args.push("-p", parent);
    parent = execFileSync("git", args, {
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_NAME: "New Name", GIT_AUTHOR_EMAIL: "new@example.invalid", GIT_COMMITTER_NAME: "New Name", GIT_COMMITTER_EMAIL: "new@example.invalid" },
    }).trim();
  }
  git("-C", publisher, "reset", "-q", "--hard", parent);
  git("-C", publisher, "push", "-q", "-f", "origin", "HEAD:main");
  return parent;
}

function rewrittenFixture(t) {
  const f = fixture(t, { ahead: false });
  fs.writeFileSync(path.join(f.publisher, "README.md"), "v2\n");
  commitAll(f.publisher, "feat: second release");
  git("-C", f.publisher, "push", "-q", "origin", "main");
  git("-C", f.clone, "pull", "-q", "--ff-only");
  const oldHead = git("-C", f.clone, "rev-parse", "HEAD");
  const rewritten = rewriteHistory(f.publisher);
  fs.writeFileSync(path.join(f.publisher, "README.md"), "v3\n");
  commitAll(f.publisher, "fix: first change after the rewrite");
  git("-C", f.publisher, "push", "-q", "origin", "main");
  return { ...f, oldHead, rewritten, remoteHead: git("-C", f.publisher, "rev-parse", "HEAD") };
}

test("a clone from before a history rewrite is offered a realignment, not a permanent warning", t => {
  const f = rewrittenFixture(t);
  const before = f.snapshot();
  const refused = f.run(["--now"]);
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.match(refused.stdout, /cloned before the project rewrote its published history/);
  assert.match(refused.stdout, /2 local commits are old copies of the project's own commits/);
  assert.match(refused.stdout, /self-update\.js" --realign/);
  assert.equal(f.state().lastResult, "refused: rewritten history (realign available)");
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.oldHead);
  const check = f.run(["--check", "--now"]);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /--realign/);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.oldHead);

  const realigned = f.run(["--realign"]);
  assert.equal(realigned.status, 0, realigned.stdout + realigned.stderr);
  assert.match(realigned.stdout, /old history is kept on branch allsorted-backup\/pre-realign-\d{8}-\d{6}/);
  assert.match(realigned.stdout, /realigned onto the project's history at [0-9a-f]{7} \(no files changed\)/);
  assert.match(realigned.stdout, /Fixes:\n\s+- first change after the rewrite/);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.remoteHead);
  const branches = git("-C", f.clone, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/allsorted-backup/");
  assert.match(branches, new RegExp(`^allsorted-backup/pre-realign-\\d{8}-\\d{6} ${f.oldHead}$`));
  assert.deepEqual(f.snapshot(), before);
  assert.match(f.state().lastResult, /^updated to [0-9a-f]{7}$/);
  // Next week it is an ordinary, current clone.
  const again = f.run(["--now"]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /is up to date/);
});

test("a clone with its own commit on top of the old history is not realigned", t => {
  const f = rewrittenFixture(t);
  fs.writeFileSync(path.join(f.clone, "README.md"), "my own change\n");
  commitAll(f.clone, "my change");
  const mine = git("-C", f.clone, "rev-parse", "HEAD");
  const refused = f.run(["--now"]);
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.match(refused.stdout, /your copy has commits that the project does not/);
  assert.doesNotMatch(refused.stdout, /--realign/);
  const forced = f.run(["--realign"]);
  assert.equal(forced.status, 2, forced.stdout + forced.stderr);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), mine);
  assert.equal(git("-C", f.clone, "for-each-ref", "refs/heads/allsorted-backup/"), "");
});

test("rewrite detection matches reordered commits by patch-id and needs identical files", t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "self update rewrite ")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  git("init", "-q", "--initial-branch=main", base);
  const write = (name, text) => fs.writeFileSync(path.join(base, name), text);
  write("root.txt", "root\n");
  commitAll(base, "root");
  const root = git("-C", base, "rev-parse", "HEAD");
  // Old history adds b then a; the rewritten one adds a then b.
  write("b.txt", "b\n"); commitAll(base, "add b");
  write("a.txt", "a\n"); commitAll(base, "add a");
  const oldHead = git("-C", base, "rev-parse", "HEAD");
  git("-C", base, "checkout", "-q", "-b", "rewritten", root);
  write("a.txt", "a\n"); commitAll(base, "add a");
  write("b.txt", "b\n"); commitAll(base, "add b");
  const newHead = git("-C", base, "rev-parse", "HEAD");
  assert.deepEqual(lib.findRewrite(base, oldHead, newHead), { target: newHead, matched: 2 });
  // An old history whose final files differ from every project commit is not a rewrite.
  git("-C", base, "checkout", "-q", "-b", "diverged", oldHead);
  write("mine.txt", "mine\n"); commitAll(base, "my file");
  assert.equal(lib.findRewrite(base, git("-C", base, "rev-parse", "HEAD"), newHead), null);
  // Same files at the end, but one local commit the project never had.
  git("-C", base, "rm", "-q", "mine.txt"); commitAll(base, "remove my file");
  assert.equal(lib.findRewrite(base, git("-C", base, "rev-parse", "HEAD"), newHead), null);
  // A member who reverted the newest release has the previous release's files,
  // but the revert is their own decision and must never be undone by a realign.
  git("-C", base, "checkout", "-q", "-b", "reverted", newHead);
  git("-C", base, ...commitArgs, "revert", "--no-edit", "HEAD");
  assert.equal(lib.findRewrite(base, git("-C", base, "rev-parse", "HEAD"), newHead), null);
});

test("--check on a pre-rewrite clone points at --realign in one line and changes nothing", t => {
  const f = rewrittenFixture(t);
  for (const args of [["--check", "--now"], ["--check", "--realign"]]) {
    const result = f.run(args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim().split("\n").length, 1, result.stdout);
    assert.match(result.stdout, /cloned before the project rewrote its history.*--realign/);
    assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.oldHead);
    assert.equal(git("-C", f.clone, "for-each-ref", "refs/heads/allsorted-backup/"), "");
  }
  assert.match(f.state().lastResult, /^update available: realign needed/);
});

test("a realign whose update then fails its self-test rolls back onto the new history, old history kept", t => {
  const f = rewrittenFixture(t);
  fs.writeFileSync(path.join(f.publisher, "test/selftest.test.js"), 'require("node:test")("fails", () => { throw new Error("broken release"); });\n');
  commitAll(f.publisher, "feat: a broken release");
  git("-C", f.publisher, "push", "-q", "origin", "main");
  const before = f.snapshot();
  const result = f.run(["--realign"]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /self-test failed/);
  assert.match(result.stdout, /old history is still on branch allsorted-backup\/pre-realign-/);
  // Rolled back to the rewritten copy of the member's own commit: same files as before.
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD^{tree}"), git("-C", f.clone, "rev-parse", `${f.oldHead}^{tree}`));
  git("-C", f.clone, "merge-base", "--is-ancestor", "HEAD", "origin/main"); // throws if HEAD left the project's history
  assert.deepEqual(f.snapshot(), before);
  assert.match(git("-C", f.clone, "for-each-ref", "--format=%(objectname)", "refs/heads/allsorted-backup/"), new RegExp(`^${f.oldHead}$`));
});

test("a folder reached through a differently cased path is still a dedicated clone", t => {
  const previous = process.env.ALLSORTED_SELF_UPDATE_PLATFORM;
  t.after(() => { if (previous === undefined) delete process.env.ALLSORTED_SELF_UPDATE_PLATFORM; else process.env.ALLSORTED_SELF_UPDATE_PLATFORM = previous; });
  process.env.ALLSORTED_SELF_UPDATE_PLATFORM = "darwin";
  assert.equal(lib.dedicatedClone("/Users/sam/Projects/strategist", "/Users/sam/projects/strategist"), true);
  assert.equal(lib.dedicatedClone("/Users/sam/Projects/strategist", "/Users/sam/projects/strategist/tool"), true);
  assert.equal(lib.dedicatedClone("/Users/sam/Projects/strategist", "/Users/sam/projects/other"), false);
  process.env.ALLSORTED_SELF_UPDATE_PLATFORM = "linux";
  assert.equal(lib.dedicatedClone("/Users/sam/Projects/strategist", "/Users/sam/projects/strategist"), false);
  assert.equal(lib.dedicatedClone("/repo", "/repo"), true);
});

test("on a case-insensitive disk the updater runs from a differently cased path", t => {
  const f = fixture(t);
  const flipped = path.join(path.dirname(f.clone), path.basename(f.clone).toUpperCase());
  if (!fs.existsSync(flipped)) { t.skip("this disk is case-sensitive"); return; }
  const result = spawnSync(process.execPath, [path.join(flipped, "scripts/self-update.js"), "--now"], {
    cwd: flipped, encoding: "utf8", timeout: 120000,
    env: { ...process.env, HOME: f.base, ALLSORTED_AUTO_UPDATE: "", ALLSORTED_SELF_UPDATE_NO_LAUNCHCTL: "1" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /sits inside a larger repository/);
  assert.equal(git("-C", f.clone, "rev-parse", "HEAD"), f.remoteHead);
});

test("protected globs, self-test selection and grouping", () => {
  for (const file of [".env", ".env.local", "config.json", "meta-ads/config/config.json", "data/x.json", "meta-ads/data/cache/y.json", "runs/1/out.json", "personal/me.md", "brand/kit.json", "state/updates.json", "library/a.png", "settings.local.json"]) {
    assert.equal(lib.matchesProtected(file), true, file);
  }
  for (const file of ["README.md", "src/index.js", "config/config.example.json", ".env.example", "brand/brand.example.json", "package.json", "test/data.test.js"]) {
    assert.equal(lib.matchesProtected(file), false, file);
  }
  assert.deepEqual(lib.selfTestCommand({ scripts: { selftest: "node check.js", test: "vitest" } }), { command: "node check.js", name: "selftest" });
  assert.deepEqual(lib.selfTestCommand({ scripts: { test: "node --test test/index.js" } }), { command: "node --test test/index.js", name: "test" });
  assert.match(lib.selfTestCommand({ scripts: { test: "vitest run" } }).skipped, /not marked offline-safe/);
  assert.deepEqual(lib.selfTestCommand({ scripts: { test: "vitest run" }, allsortedUpdate: { offlineTest: true } }), { command: "vitest run", name: "test" });
  assert.match(lib.selfTestCommand({}).skipped, /no selftest or test script/);
  assert.deepEqual(lib.groupSubjects(["feat(ui): new screen", "fix: crash", "docs: readme", "chore: bump", "plain subject"]), {
    "New": ["new screen"], "Fixes": ["crash"], "Docs": ["readme"], "Changes": ["bump", "plain subject"],
  });
  assert.ok(lib.PROTECTED_GLOBS.includes(".env*") && lib.PROTECTED_GLOBS.includes("config.json") && lib.PROTECTED_GLOBS.includes("data/**"));
});
