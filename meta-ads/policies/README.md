## Check my ads against Meta's policies

Meta rejects ads that break its Advertising Standards, and too many rejections can restrict your ad account.
This agent reads your ad text before anything is created and tells you, in plain words, what Meta is likely to object to and how to rewrite it.

Check any ad yourself:

```bash
node src/index.js policy check "Are you struggling with anxiety? Feel better in 7 days, guaranteed."
node src/index.js policy check my-creative.json          # a creative or carousel spec
node src/index.js policy check exports/meta-carousel.json # a Content Studio handoff, image text included
node src/index.js policy check 120200000000000            # an ad or creative id from your last sync
node src/index.js policy check "..." --json               # for scripts
node src/index.js policy rules                            # every rule the agent knows
```

It checks the headline, primary text, description, button, image text and link. Each problem comes back as:

- **BLOCK**: Meta will very likely reject this. Fix it first.
- **WARN**: check it. It may limit delivery, need an 18+ audience, need Meta's permission, or need a Special Ad Category (housing, jobs, credit, politics).
- **PASS**: nothing the agent knows about.

Every result shows the exact phrase, why it is a problem, and a suggested rewrite. Exit codes: 2 for BLOCK, 1 for WARN, 0 for PASS.

### You are protected without asking

`ads create`, `creatives create`, `creatives carousel` and `draft-campaign` run the same check first, dry runs included.
A BLOCK stops the command and shows the rewrites. If you are sure the text is fine (for example Meta support approved it), add
`--policy-override "<your reason>"`. The reason and the rules you overrode are saved in the audit log. A WARN prints and carries on.
The writes switch and the daily budget cap still apply exactly as before.

### Meta rejected an ad

Use the recipe "Fix an ad Meta rejected" (`recipes/rejected-ad-fix.js`) with Meta's rejection text, the ad id, or both.
It maps the reason to the rules, points at the phrases to change and drafts the fix. Nothing is sent to Meta.

### Ads in other languages

The check reads English, Spanish, Portuguese, French, German, Italian, Dutch and Indonesian, and copy that mixes them.
Accents are optional (`depresión` and `depresion` both match) and every result says which language it found, for example `Language: Spanish (checked).`
It covers the main rejection reasons in each language: personal attributes ("you" plus a condition, debt, religion), health, weight-loss and before/after claims, income and investment promises, discrimination, and prohibited goods (tobacco and vapes, weapons, fake prizes, payday loans).

Text in any other language (Thai, Japanese, Russian, Tagalog and so on) is not passed silently. It comes back as a WARN:
`Not checked for Thai, review by hand`. Read that text yourself against `meta-advertising-standards.md` before the ad runs.
Any sentence or headline whose language the check cannot place with confidence is checked against every word list and comes back as a WARN saying the language was not identified, unless it clearly reads as English.
The language guess is a cheap word and letter count, so treat it as a label, not proof: every word list runs on every ad either way.
The check runs offline from word lists; it does not call a model or Meta.

### Where the rules live

- `policies/meta-advertising-standards.md`: Meta's rules in plain words, with links to Meta's pages.
- `policies/rules.json`: the patterns the check uses. Each rule has an id, a level, an explanation and a rewrite hint. Add your own by copying one.
- `policies/rules-i18n.json`: the word lists for the other languages. Each list reuses a rule id from `rules.json`. Write patterns without accents.

Meta changes its rules often. `doctor` warns when the guide is more than 90 days old. The check is a safety net, not a guarantee: Meta reviews images, video and landing pages too.
