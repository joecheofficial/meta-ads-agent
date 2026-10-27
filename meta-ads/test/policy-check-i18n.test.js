// Multilingual Meta policy check: one flagged and one clean ad per language
// per policy category (fixtures in test/fixtures/policy-i18n-cases.json),
// languages with no word list, mixed-language copy, Unicode normalisation and
// word boundaries. Offline: the check never calls Meta, and the one CLI run
// blocks fetch and uses placeholder credentials.
const test = require("node:test");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const policy = require("../src/policy-check");
const cases = require("./fixtures/policy-i18n-cases.json");

const cli = path.join(__dirname, "../src/index.js");
const CATEGORIES = ["personal", "health", "financial", "discrimination", "prohibited"];
const LANGUAGES = ["es", "pt", "fr", "de", "it", "nl", "id"];

function ids(report) {
  return [...new Set(report.findings.map((finding) => finding.ruleId))];
}

test("fixtures cover every language and category", () => {
  assert.deepStrictEqual(Object.keys(cases.languages).sort(), [...LANGUAGES].sort());
  for (const code of LANGUAGES) assert.deepStrictEqual(Object.keys(cases.languages[code]).sort(), [...CATEGORIES].sort(), code);
  const i18n = policy.loadI18n();
  for (const code of LANGUAGES) assert.ok(i18n.languages[code] && i18n.languages[code].rules.length, `${code} has word lists`);
});

for (const code of LANGUAGES) {
  for (const category of CATEGORIES) {
    test(`${code} ${category}: flags the risky ad and passes the clean one`, () => {
      const fixture = cases.languages[code][category];
      const flagged = policy.checkText(fixture.flag);
      assert.ok(ids(flagged).includes(fixture.rule), `${code}/${category} expected ${fixture.rule}, got ${JSON.stringify(flagged.findings.map((f) => [f.ruleId, f.phrase]))}`);
      assert.notStrictEqual(flagged.status, "PASS");
      const finding = flagged.findings.find((item) => item.ruleId === fixture.rule);
      assert.ok(finding.explain && finding.rewrite && finding.source, "the finding carries the English rule's explanation, rewrite and source");
      assert.ok(fixture.flag.includes(finding.phrase), `phrase "${finding.phrase}" is quoted in the advertiser's own spelling`);

      const clean = policy.checkText(fixture.clean);
      assert.strictEqual(clean.status, "PASS", `${code}/${category} clean copy: ${JSON.stringify(clean.findings.map((f) => [f.ruleId, f.phrase]))}`);
      assert.strictEqual(clean.findings.length, 0);
    });
  }
}

test("accents are optional and the phrase keeps the original spelling", () => {
  const withAccent = policy.checkText("¿Sufres de depresión? Te acompañamos.");
  const without = policy.checkText("Sufres de depresion? Te acompanamos.");
  assert.ok(ids(withAccent).includes("personal-attributes-health"));
  assert.ok(ids(without).includes("personal-attributes-health"));
  assert.strictEqual(withAccent.findings.find((f) => f.ruleId === "personal-attributes-health").phrase, "¿Sufres de depresión?");
  const german = policy.checkText("Verliere 5 Kilo – Kleidergrößen purzeln, garantiert.");
  assert.ok(ids(german).includes("guaranteed-results"));
});

test("Unicode normalisation: full-width letters and hidden characters cannot dodge a rule", () => {
  assert.ok(ids(policy.checkText("Results ｇｕａｒａｎｔｅｅｄ.")).includes("guaranteed-results"));
  assert.ok(ids(policy.checkText("Results guaran​teed.")).includes("guaranteed-results"));
  assert.ok(ids(policy.checkText("Resultados garanti­zados.")).includes("guaranteed-results"));
});

test("word boundaries are Unicode aware: an accented letter is part of the word", () => {
  // With JavaScript's ASCII \b, "é" counted as a boundary and this matched.
  assert.ok(!ids(policy.checkText("Our guaranteedé blend.")).includes("guaranteed-results"));
  assert.ok(ids(policy.checkText("Café results guaranteed.")).includes("guaranteed-results"));
  assert.ok(!ids(policy.checkText("Esencia pistolasñ")).includes("prohibited-weapons"));
});

test("money-back and satisfaction guarantees stay allowed in other languages", () => {
  for (const text of ["Satisfacción garantizada o te devolvemos el dinero.", "Satisfação garantida ou seu dinheiro de volta.", "Satisfait ou remboursé, garantie de remboursement 30 jours.", "Garansi uang kembali 30 hari."]) {
    const report = policy.checkText(text);
    assert.ok(!ids(report).includes("guaranteed-results"), `${text}: ${JSON.stringify(report.findings.map((f) => f.phrase))}`);
  }
});

test("English copy does not trip other languages' word lists", () => {
  for (const text of cases.englishClean) {
    const report = policy.checkText(text);
    assert.strictEqual(report.status, "PASS", `${text}: ${JSON.stringify(report.findings.map((f) => [f.ruleId, f.phrase]))}`);
  }
});

test("a language with no word list is never a clean pass", () => {
  for (const fixture of cases.unsupported) {
    const report = policy.checkText(fixture.text);
    assert.strictEqual(report.status, "WARN", fixture.name);
    assert.strictEqual(report.exitCode, 1);
    const finding = report.findings.find((f) => f.ruleId === "language-not-checked");
    assert.ok(finding, `${fixture.name} gets a language-not-checked finding`);
    assert.strictEqual(finding.language, fixture.language);
    assert.strictEqual(finding.title, `Not checked for ${fixture.name}, review by hand`);
    assert.ok(report.languages.notChecked.some((lang) => lang.code === fixture.language));
    const text = policy.formatReport(report);
    assert.match(text, new RegExp(`Not checked for ${fixture.name.replace(/[()]/g, "\\$&")}, review by hand`));
    assert.match(text, /not checked, review by hand/);
    assert.doesNotMatch(text, /^Meta policy check: PASS/);
  }
});

test("an unrecognised language in a long sentence is flagged, short copy is not", () => {
  const unknown = policy.checkText("Xyl qorv blent mupa trazo vellin quarn dothe");
  assert.strictEqual(unknown.status, "WARN");
  assert.ok(unknown.languages.unrecognised);
  assert.strictEqual(unknown.findings[0].language, "und");
  assert.strictEqual(policy.checkText("Free Workshop").status, "PASS");
});

test("first-person French, Italian origin claims and a German satisfaction guarantee are not flagged", () => {
  for (const text of cases.otherClean) {
    const report = policy.checkText(text);
    assert.ok(!report.findings.some((f) => f.level === "BLOCK"), `${text}: ${JSON.stringify(report.findings.map((f) => [f.ruleId, f.phrase]))}`);
    assert.ok(!ids(report).includes("guaranteed-results"));
  }
});

test("short headlines in languages with no word list warn instead of passing", () => {
  for (const text of cases.unsupportedShort) {
    const report = policy.checkText(text);
    assert.strictEqual(report.status, "WARN", `${text}: ${JSON.stringify(report.languages)}`);
    assert.ok(ids(report).includes("language-not-checked"), text);
    assert.ok(!report.languages.detected.some((lang) => lang.checked), `${text} must not be labelled as a checked language`);
  }
});

test("a short headline in a language with no word list next to English body text warns", () => {
  for (const headline of cases.unsupportedHeadlines) {
    const report = policy.checkCreative({ message: "Join our free workshop in Bali this Saturday.", headline });
    assert.strictEqual(report.status, "WARN", headline);
    assert.ok(report.findings.some((f) => f.ruleId === "language-not-checked" && f.field === "headline"), headline);
  }
});

test("one word shared with a language that has no list does not mislabel English", () => {
  for (const text of cases.englishNotMislabelled) {
    const report = policy.checkText(text);
    assert.strictEqual(report.status, "PASS", `${text}: ${JSON.stringify(report.findings.map((f) => [f.ruleId, f.language]))}`);
    assert.deepStrictEqual(report.languages.notChecked, [], text);
  }
});

test("wrapped lines are joined before the personal-attribute rule runs", () => {
  assert.ok(ids(policy.checkText("Are you\n\n\n depressed?")).includes("personal-attributes-health"));
  assert.ok(ids(policy.checkText("¿Sufres\nde ansiedad?")).includes("personal-attributes-health"));
});

test("short headlines in a checked language are identified", () => {
  for (const text of cases.supportedHeadlines) assert.strictEqual(policy.checkText(text).status, "PASS", text);
});

test("German written without umlauts still matches", () => {
  assert.ok(ids(policy.checkText("Hast du Uebergewicht?")).includes("personal-attributes-health"));
  assert.ok(ids(policy.checkText("Herzlichen Glueckwunsch, Sie haben gewonnen!")).includes("fake-ui-or-prize"));
});

test("long runs of spaces or digits cannot stall the check", () => {
  const started = Date.now();
  policy.checkText(`gagnez 1${" ".repeat(5000)}x`);
  policy.checkText(`Gana 1${"1".repeat(20000)}x`);
  policy.checkText(`Verdien 1${"\u00A0".repeat(5000)}x`);
  policy.checkText("ab ".repeat(20000));
  policy.checkText(`gagnez 1${"\n \n".repeat(5000)}x`);
  policy.checkText(`Gana 1${"\n".repeat(20000)}x al mes`);
  assert.ok(Date.now() - started < 5000, `took ${Date.now() - started} ms`);
});

test("mixed-language copy is checked in every language it contains", () => {
  for (const fixture of cases.mixed) {
    const report = policy.checkText(fixture.text);
    for (const rule of fixture.rules) assert.ok(ids(report).includes(rule), `${fixture.text}: expected ${rule}, got ${ids(report)}`);
    const detected = report.languages.detected.map((lang) => lang.code);
    for (const code of fixture.languages) assert.ok(detected.includes(code), `${fixture.text}: expected ${code} in ${detected}`);
    for (const code of fixture.notChecked || []) assert.ok(report.languages.notChecked.some((lang) => lang.code === code));
    assert.notStrictEqual(report.status, "PASS");
  }
});

test("a carousel with an Indonesian slide and an English headline is checked field by field", () => {
  const report = policy.checkCreative({ headline: "AI Workshop Bali", slides: [{ headline: "Cara cepat kaya", text: "Turun 7 kg dalam seminggu" }] });
  assert.ok(ids(report).includes("income-claims"));
  assert.ok(ids(report).includes("weight-loss-claims"));
  assert.ok(report.findings.filter((f) => f.ruleId !== "language-not-checked").every((f) => f.field === "overlayText"));
});

test("the report states the language it detected", () => {
  const spanish = policy.checkText("¿Tienes deudas? Te ayudamos a salir de ellas.");
  assert.deepStrictEqual(spanish.languages.detected.map((lang) => lang.code), ["es"]);
  assert.match(policy.formatReport(spanish), /Language: Spanish \(checked\)/);
  assert.match(spanish.languages.method, /no model call/);
  const mixed = policy.checkText("Join our class today. สมัครวันนี้ รับรายได้ 100,000 บาทต่อเดือน");
  assert.match(policy.formatReport(mixed), /Languages: English \(checked\); Thai \(not checked, review by hand\)/);
});

test("the create-path guard blocks Indonesian income claims and lets an unchecked language through with a warning", () => {
  const lines = [];
  assert.throws(
    () => policy.enforcePolicy({ action: "ads create", input: { message: "Dapatkan Rp 20 juta per bulan, dijamin!" }, log: (line) => lines.push(line) }),
    (error) => error.exitCode === 2 && /income-claims/.test(error.message),
  );
  const warned = policy.enforcePolicy({ action: "ads create", input: { message: "สมัครวันนี้ รับรายได้ 100,000 บาทต่อเดือน" }, log: (line) => lines.push(line) });
  assert.strictEqual(warned.status, "WARN");
  assert.ok(lines.join("\n").includes("Not checked for Thai, review by hand"));
});

test("a missing word-list file reports other languages as not checked instead of passing them", () => {
  const report = policy.checkTexts(policy.extractTexts("Gana 5.000 € al mes desde casa con nuestro sistema para todos ustedes"), { i18nPath: path.join(os.tmpdir(), "no-such-rules-i18n.json") });
  assert.notStrictEqual(report.status, "PASS");
});

test("rejection reasons about discrimination map to the new rule", () => {
  assert.ok(policy.mapRejectionReason("Your ad was rejected for discriminatory practices").includes("discriminatory-practices"));
  assert.ok(policy.listRules().some((rule) => rule.id === "language-not-checked"));
});

test("CLI: a Spanish ad exits 2 and names the language (network blocked)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-i18n-"));
  const hook = path.join(dir, "block-network.js");
  fs.writeFileSync(hook, "global.fetch = async () => { throw new Error('network must not be called'); };");
  const env = {
    PATH: process.env.PATH,
    HOME: dir,
    META_ADS_ACCESS_TOKEN: "test-token",
    META_ADS_ACCOUNT_ID: "act_123",
    META_ADS_APP_ID: "test-app",
    META_ADS_APP_SECRET: "test-secret",
    META_ADS_WRITES_ENABLED: "false",
    META_ADS_AUDIT_LOG_PATH: path.join(dir, "audit.jsonl"),
    NODE_OPTIONS: `--require=${JSON.stringify(hook)}`,
    ...(process.env.NODE_PATH ? { NODE_PATH: process.env.NODE_PATH } : {}),
  };
  try {
    const run = spawnSync(process.execPath, [cli, "policy", "check", "¿Sufres de ansiedad? Resultados garantizados."], { env, encoding: "utf8" });
    assert.strictEqual(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stdout, /Language: Spanish \(checked\)/);
    assert.match(run.stdout, /personal-attributes-health/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
