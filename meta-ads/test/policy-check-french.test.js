// French ad copy gets the same Meta policy coverage as English: language
// detection on short French lines and a French word list for every text rule.
const test = require("node:test");
const assert = require("assert");
const policy = require("../src/policy-check");

function check(text) {
  return policy.checkCreative({ primaryText: text });
}
function ruleIds(report) {
  return [...new Set(report.findings.map((f) => f.ruleId))];
}
function codes(report) {
  return report.languages.detected.map((d) => d.code);
}

test("short French lines are detected as French, not Dutch or unknown", () => {
  for (const text of [
    "Tu es en surpoids ? Perds 10 kilos en 7 jours, résultats garantis !",
    "Ton coaching, tes résultats.",
    "Rejoins notre programme pour hommes.",
    "Je t'accompagne pendant douze semaines.",
  ]) {
    const report = check(text);
    assert.ok(codes(report).includes("fr"), `${text} -> ${JSON.stringify(report.languages.detected)}`);
    assert.ok(!codes(report).includes("nl"), `${text} labelled Dutch`);
    assert.strictEqual(report.languages.unrecognised, false, text);
  }
});

test("clean French copy passes with no findings", () => {
  const report = check("Découvrez notre atelier pour créer votre site web en une séance, sans code.");
  assert.strictEqual(report.status, "PASS", JSON.stringify(report.findings));
});

test("every English text rule has a French counterpart that fires", () => {
  const cases = {
    "personal-attributes-age": "Vous avez plus de 50 ans ? Ce programme est pour vous.",
    "personal-attributes-criminal-record": "Tu as un casier judiciaire ? On t'aide.",
    "fast-results-claim": "Un nouveau site en seulement 3 jours.",
    "false-urgency": "Dernière chance, plus que 2 places !",
    "sensational-clickbait": "Vous n'allez pas croire ce qui arrive ensuite.",
    "unsubstantiated-claims": "Le coaching n°1 en France, scientifiquement prouvé.",
    "profanity": "Arrête de faire de la merde avec ton business.",
    "lead-sensitive-data": "Envoyez-nous votre numéro de sécurité sociale.",
    "crisis-exploitation": "Depuis la pandémie, tout a changé pour les coachs.",
    "restricted-supplements": "Nos gélules détox pour retrouver ton énergie.",
    "restricted-alcohol": "Dégustation de vins ce samedi.",
    "restricted-dating": "Le site de rencontres pour les hommes ambitieux.",
    "restricted-gambling": "Parier sur le match avec nos paris sportifs.",
    "restricted-crypto": "Apprends le trading de bitcoin et de cryptomonnaies.",
    "restricted-pharma": "Ozempic sans ordonnance, livré chez vous.",
    "income-claims": "Gagnez 10 000 € par mois depuis chez vous.",
    "personal-attributes-health": "Tu es en surpoids ?",
    "personal-attributes-finances": "Vous êtes endetté ?",
  };
  for (const [ruleId, text] of Object.entries(cases)) {
    const report = check(text);
    assert.ok(ruleIds(report).includes(ruleId), `${ruleId} did not fire on "${text}": ${JSON.stringify(ruleIds(report))}`);
  }
});

test("French look-alikes do not trip the new rules", () => {
  for (const text of [
    "Rejoins notre retraite spirituelle à Bali avec tes amis.",
    "J'ai arrêté de fumer et ma vie a changé.",
    "Ton site web, vite et bien fait.",
    "Rejoignez notre retraite yoga à Bali : vous repartirez ressourcé.",
    "Vos retraites bien-être en Provence.",
    "Vous gardez 100 % du capital détenu.",
    "Votre pain bâtard et vos croissants chaque matin.",
    "Relevez le défi : 30 jours pour lancer votre entreprise.",
    "Vous les aurez en 3 jours ouvrés.",
    "Votre marketing en 5 minutes par jour.",
    "Prime rib and fries tonight.",
  ]) {
    const report = check(text);
    const hits = ruleIds(report).filter((id) => ["personal-attributes-age", "personal-attributes-criminal-record", "false-urgency", "profanity", "restricted-crypto", "fast-results-claim", "lead-sensitive-data"].includes(id));
    assert.deepStrictEqual(hits, [], `${text} -> ${JSON.stringify(hits)}`);
  }
});

test("English detection is unchanged by the larger French word list", () => {
  const report = check("Join our free workshop today and build your website in one session.");
  assert.ok(codes(report).includes("en"), JSON.stringify(report.languages.detected));
  assert.ok(!codes(report).includes("fr"));
});
