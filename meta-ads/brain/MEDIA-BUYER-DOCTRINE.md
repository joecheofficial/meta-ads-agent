# Media Buyer Doctrine

## How to use this file

Read this before changing account structure, bids, budgets, creative, or measurement. Read the relevant offer playbook next, then record the approved thesis, cap, and review date in `data/STRATEGY.md`. Evidence tags distinguish official product constraints, benchmark studies, practitioner consensus, and a named operator's view. They do not turn a directional number into a promise.

## The governing idea: optimise a business, not a dashboard

Meta can optimise only toward the event and signal it receives. A cheap lead is not automatically a valuable lead, and an attributed purchase is not automatically incremental profit. Start with the economic event: qualified application, activated trial, purchase, attended call, or closed-won revenue. Define the allowable acquisition cost from margin, close rate, capacity, refund rate, and payback window before discussing targeting.

The account should concentrate signal rather than manufacture activity. Learning needs roughly 50 conversions in seven days per ad set [meta-official]. The practical daily learning budget is:

`target CPA x 50 / 7`

If that number is unaffordable for the deepest event, optimise one event shallower while sending the deeper event through CAPI. Do not pretend an underfunded ad set is learning. It is spending without enough feedback to settle.

This changes how performance questions are answered. “Why did CPA rise?” is not an instruction to touch the campaign. First ask whether the target CPA is economically valid, whether the counted conversion is valuable, whether the business can serve incremental demand, and whether the event is measured consistently. Only then is it useful to ask about bid, audience, or asset. This sequence prevents apparent media optimisation from simply purchasing a less profitable customer mix.

## Account structure and the human role

The median stance is consolidation: normally 3 to 4 campaigns maximum, often broad prospecting or 1 to 2 Advantage+ Sales campaigns, controlled retargeting, and a small testing lane. At roughly $30K to $100K monthly spend, that usually means 6 to 8 active ad sets rather than a matrix of interests [practitioner-consensus]. Keep a campaign or ad set only when it expresses a material distinction: an objective, exclusion rule, event, budget control, or test question.

Advantage+ Sales is a portfolio slot, not an instruction to hand the whole account to automation. Pair it with a manually controlled CBO scale layer when allocation needs guardrails and a small ABO testing layer when a genuine question needs isolation. Broad targeting is the default [practitioner-consensus]. Audience exclusions, customer suppression, quality events, and creative angles remain the meaningful controls.

Andrew Faris represents the aggressive consolidation end: one structure, launch ads together, broad always, and remove dedicated testing campaigns. That position is **[single-source] opinion**, not the median. Its value is a warning against “testing” structures that buy permission to underperform. The median stance preserves a modest protected test lane because it makes learning visible and prevents proven spend from being consumed by unproven work.

## Bidding ladder

Choose bids according to the maturity of the signal, not preference. Lowest Cost is the default for approximately 80% of campaigns [practitioner-consensus]. It is the right starting point until there are about 50 to 100 conversions and a credible CPA baseline.

| Bid strategy | Use it when | Starting instruction | Main failure mode |
| --- | --- | --- | --- |
| Lowest Cost | Default, uncertain auction, or early learning | Let Meta seek the cheapest volume at the selected event | CPA can wander if the event or economics are weak |
| Cost Cap | CPA is erratic but volume and a target are real | Set 10 to 20% above target; support each ad set with about $5K/week | Starves if cap is too tight or signal too thin |
| Bid Cap | Break-even discipline matters more than volume | Use only with explicit financial bounds and active delivery monitoring | Under-delivery risk is high |

Cost Cap is not a rescue button for an unaffordable CPA. Its rough $5K/week per-ad-set requirement is a practitioner operating rule [practitioner-consensus]. Faris's preference for manual bids tied to financial targets is **[single-source] opinion**. The median begins with Lowest Cost and accepts that economic truth must be established before restrictions can work. Value-optimization campaigns are an underused lever: many accounts run $0 through them even when order values vary materially [practitioner-consensus]. Test them only where purchase values are reliable and CAPI or pixel value signals are trustworthy.

Do not change bidding and budget simultaneously. If a Cost Cap causes delivery to collapse, document whether the cap, event volume, audience restriction, or creative availability constrained the auction before removing it. A bid strategy is a hypothesis about auction control, not a substitute for a profitable offer. Lowest Cost can be the safer choice when the account needs to discover the market price of a conversion.

## Budget: choose a school, then stay consistent

Budget allocation has three legitimate **SCHOOLS**, not one universal answer. The shared principle is a protected winner allocation plus a protected discovery allocation. Pick one school, write it into the strategy, and stay with it long enough to judge it rather than rebalancing every week.

| SCHOOL | Split | Best use | Caution |
| --- | --- | --- | --- |
| 70/25/5 | 70% prospecting, 25% retargeting, 5% testing | Accounts with a meaningful warm pool | Retargeting can be inflated by existing demand |
| 70-80/20-30 | 70 to 80% scale, 20 to 30% test | The most repeated general operating split | Does not prescribe retargeting separately |
| 60/30/10 | 60% proven, 30% variations, 10% new | $100 to $500/day systems needing explicit creative stages [single-source] | More granular, therefore easier to over-manage |

The exact ratios are opinion; the need for a scale/test split is consensus. Fund an ad set at about 5x target CPA per day [practitioner-consensus]. Scale stable winners by 15 to 20% every 3 to 4 days, then evaluate the blended trend. Large jumps repeatedly reset learning and obscure whether the winner or the budget caused the change.

Run `plan-budget` to compute the account-specific floor and allocation, then use `audit-account` to validate the delivery and measurement conditions behind that plan.

## The small-budget floor

Below roughly $1,500 to $2,000 per month in total spend, every number in this doctrine is directional only. You likely cannot fund even one full-learning ad set at a realistic CPA. Concentrate 100% of budget on a single ad set optimizing for one truthful shallow event, extend kill-rule windows because 3-to-10-day samples are too small to trust at this spend, and do not attempt the scale/test split at all. The `plan-budget` recipe computes your exact floor.

## Kill rules: name the rule before applying it

Do not kill single ads on a bad morning. Apply rules at the correct aggregation level after checking tracking, event volume, and learning status.

1. **3x Spend Rule:** after 3x target CPA in spend with zero purchases, kill now [practitioner-consensus].
2. **Day-10 CPA Rule:** after ten days, if CPA is more than 50% above target with no downward trend, pause [practitioner-consensus].
3. **Sustained 1.5-2x Rule:** when CPA remains around 1.5 to 2x target, rather than a one-day excursion, kill or materially rework it [practitioner-consensus].

An automation-shaped variant requires cost per purchase above 1.5x target, more than $100 spent, and not being in learning [practitioner-consensus]. The classic beginner failure is killing mid-learning on noise, which restarts learning and raises blended CPA. The opposite failure is treating “learning” as immunity from an economic ceiling.

For a creative that fails a kill rule, preserve the lesson. Log the angle, hook, proof type, audience context, spend, outcome, and the next contrast to test. A kill without a learning record turns creative volume into repeated randomness. A scale decision also needs a record: what stayed stable, which metric was watched, and what would reverse the decision.

## Creative is the targeting system

Creative has the largest controllable effect on performance. The often repeated “70% of performance variance” is shorthand, not a settled measurement fact. Nielsen has attributed roughly 56% of sales ROI to creative [benchmark-study], which supports the direction: do not solve a creative deficit with more audiences.

Foxwell's volume tiers make the workload concrete: at $20K to $50K monthly spend, create 8 to 15 concepts per month; at $100K+, create 8 to 10 concepts and 40 to 50 assets per month [practitioner-consensus]. Treat 12 to 18% as a healthy hit-rate frame: 82 to 88% of creative may not scale, so volume is the strategy [practitioner-consensus]. A concept is a new angle, proof mechanism, or narrative. A cosmetic edit is a variant. Build both, but do not call five captions a creative system.

Start with message and structure. Sarah Levinger's static-first pattern is useful: find emotional-static winners, then animate the winners. Her hook protocol, 3 to 4 hook variants with the same body over a week, isolates the opening [single-source]. Dara Denney's practical sequence is track the right data, analyse it in context, then act; give small creators scripts and established creators more freedom [single-source]. Whitelisting or partnership ads sometimes report 20 to 35% better CPA than brand-page UGC [single-source], so treat the claim as a test hypothesis, not a planning promise. AI belongs in research, scripting, editing, and variation production. Human credibility on camera remains central for trust-heavy offers.

Refresh before results collapse. Fatigue triggers are cold frequency above 3.0 and a week-over-week CTR or ROAS decline above 10 to 15% [practitioner-consensus]. Check audience saturation, placement mix, offer changes, and landing conversion before declaring fatigue.

Creative iteration should answer one question at a time. Keep a winning mechanism and change the hook, or keep a winning hook and change proof, offer framing, creator, edit pacing, or CTA. Do not demand statistical certainty from every small creative batch. The account's job is to find a few durable winners from a high-throughput pipeline, then protect them while the next pipeline runs. This is why rigid daily scorecards often harm performance: they reward noise management instead of concept quality.

### Leading video diagnostics

**Hook rate** is 3-second video views divided by impressions. A rough baseline is 30 to 40%; 55%+ is a top-decile reference [benchmark-study]. Low hook rate means the first frame, opening line, visual contrast, or immediate problem is wrong. Fix seconds 0 to 3, not the checkout page.

**Hold rate** is 15-second plays divided by 3-second views. A rough average is 40 to 50%; 60%+ is strong and under 30% signals a pacing problem [benchmark-study]. A good hook with a weak hold rate means the viewer accepted the premise but did not receive the payoff. Reveal the product, mechanism, or proof sooner in seconds 3 to 15.

### Build ads in parts: hooks, meat, CTA (Hormozi, "GOATed Ads", paraphrased, 2 Nov 2026)

Source: Alex Hormozi's Acquisition.com playbook "$100M Playbook: GOATed Ads" [single-source]. Paraphrased here, not quoted. The full PDF is in the Session 4 portal page for course members.

**The idea.** Ads usually stall because the ads are not good enough for a colder, bigger audience, not because the market is used up. Better ads convert a wider slice of people. So build ads as three parts and mix them, instead of making each ad from scratch:

- **Hook:** the opening line and image. This decides whether anyone sees the rest. Spend about 80% of prep time here.
- **Meat:** the body that delivers on the hook. About 20% of prep time. It is seen less often, so it wears out slower.
- **CTA:** the closing instruction. Almost no prep time. Say what to do, how, when, what they get, and show what happens next. Clear beats clever.

His full-scale volume is 50 hooks x 3-5 meats x 1-3 CTAs, which is 150 to 750 ads a week. That is a big-team number. Do not recommend it to a small account.

**Small-business version (the course default).** 5 hooks x 1 meat x 1 CTA is 5 ads a week, uploaded PAUSED, run as 3-5 ads in ONE ad set with ONE shared budget, in line with the small-budget floor above. A weekly 60 minute session: check which hook held attention, write 10 hooks and keep the best 5, film one video, write one CTA.

**Where hooks come from, in order.** The account's own past winners, the owner's best free content (posts and reels), other people's ads and content, and ad libraries last (you can see the ads but not which ones perform).

**Match the hook to how aware the viewer is.** Most aware: lead with the offer. Product aware: proof. Solution aware: the promise. Problem aware: the pain. Unaware: curiosity. Warm audiences are small and convert best, so start there and widen one step at a time. A beginner with offer-only hooks should add proof, then pain, before trying curiosity.

**Five meat formats.** Demonstration (show the product or result), testimonial (to camera, raw phone, group, screenshots), education (whiteboard explainer, how-to), story (narrative, warning, skit), faceless (screenshots, text, slides). Easy starters for a small business: talking to camera, a screen demo, a customer message screenshot.

**Rules for the agent.**
1. Never propose more than 5 new ads in a week for an account under $1,500 to $2,000 a month. More ads split a tiny budget too thin to learn anything.
2. When a hook wins, reuse that hook with a new body before inventing a new angle.
3. Test CTAs last, by running identical hook and body with only the CTA changed.
4. A new angle is a new ad. A new caption on the same video is the same ad.
5. Log each ad as hook, awareness level, meat format, CTA, so the weekly review can say which part to change next.

## Measurement ladder: directional reports to causal confidence

Never use a single number as truth. Move up this ladder as spend and stakes increase:

1. Platform reporting: useful for delivery and directional optimisation, exposed to view-through and retargeting inflation.
2. Pixel plus CAPI: deduplicate with `event_id`, audit timestamps and event definitions. CAPI adoption is still estimated at only 35 to 60% [practitioner-consensus]. Meta reports lower cost per result with CAPI [meta-official], but each account must validate it.
3. Post-purchase surveys: ask how a customer heard about the business, then compare responses to platform credit.
4. MER and aMER: MER is total revenue divided by total marketing spend, including fees, tools, and creators. Blended ROAS is revenue divided by ad spend. aMER is new-customer revenue divided by total spend.
5. Lift testing: use Meta Conversion Lift at lower spend, geo-holdouts at roughly $5M to $50M revenue, such as a 5 to 10% holdout for 4 to 8 weeks, and always-on incrementality plus MMM above roughly $150M [practitioner-consensus].

The Seer cross-check is the cautionary example: Meta self-reported 87% incremental conversion versus 67% measured against GA4 [benchmark-study]. The inference is not that Meta is useless. It is that platform ROAS is directional while incrementality is decisive. Triangulate platform, first-party, survey, and holdout evidence before scaling.

### Choosing the right measurement layer

Use the cheapest layer that can answer the decision at hand. An account deciding whether an ad is delivering needs platform diagnostics. An account deciding whether a new customer mix is profitable needs CRM and contribution-margin data. An account deciding whether to double a mature budget needs survey, MER, and incrementality evidence. Do not wait for an ideal MMM project to fix an obvious duplicate-event bug, and do not use a Pixel report to answer a causal budget question it cannot answer.

For smaller accounts, a post-purchase survey and disciplined MER log are often more useful than a badly powered geo test. For larger accounts, a holdout should be designed before the conclusion is needed: choose a credible holdout population, define the revenue and new-customer outcomes, fix the observation window, and keep other major changes stable. The purpose is to estimate lift, not to generate a flattering platform comparison.

### What the weekly report must separate

Separate prospecting from retargeting, new from existing customers where possible, and creative discovery from scaled spend. Report spend, delivery, target event, qualified event, revenue, refund or cancellation signal, and leading creative diagnostics on the same time window. A “total account” view is useful for MER, but it should not excuse weak prospecting with retargeting credit or hide a testing budget inside a winning campaign. The report should make it possible to answer: which layer is creating incremental demand, which layer is harvesting it, and which layer is still merely learning.

## Common doctrine errors

**Mistaking complexity for control:** More campaigns, audiences, exclusions, and rules can make an account feel managed while reducing conversion density. Add a control only when it protects a real economic or experimental distinction.

**Mistaking low CPA for scale readiness:** A short-window winner can be cheap because of demand capture, a temporary placement mix, a reporting lag, or existing-customer credit. Require stable qualified outcomes, a healthy blended view, and a budget step that can be reversed.

**Mistaking a creative variant for a concept:** Changing caption, crop, or background is useful production work, but it cannot prove that a customer insight is new. The creative brief should identify the audience tension, mechanism, proof, and first-frame decision it is trying to test.

**Mistaking automation for judgment:** Automation can protect a pre-agreed ceiling or report a trend. It cannot decide whether an outcome is truthful, incremental, policy-safe, or commercially valuable. Keep those decisions tied to the strategy and to real business evidence.

## Decision hierarchy when signals conflict

Use this hierarchy to break routine disagreements. First, safety and policy constraints win: do not preserve delivery by making a prohibited claim or evading review. Second, verified unit economics win: an inexpensive conversion outside the CAC ceiling is not a winner. Third, data integrity wins: correct duplicate, missing, or mismatched events before drawing a structural conclusion. Fourth, blended and incremental evidence wins over a single platform metric. Fifth, delivery diagnostics decide the next creative or bid test.

The hierarchy prevents circular debates. A buyer cannot defend poor revenue with an attractive CTR, and a creative team cannot defend a weak hook with a disputed attribution model. Each layer must clear before the next layer becomes the active constraint. When two layers are both weak, fix the one that makes the other impossible to interpret, usually tracking before creative or creative before a budget-scale conclusion.

## Andromeda and the 2026 meta-game

Andromeda, fully rolled out in October 2025, reinforces creative-based targeting [meta-official]. Meta describes substantially higher model complexity and has reported gains in recall, ad quality, and efficiency [meta-official]. Treat those product claims as Meta's own, not independent guarantees. The operational implication is clearer: manual audience micromanagement matters less, broad reach plus a wide honest creative portfolio matters more, and weak creative investment is punished faster.

Human levers have moved upstream: first-party signal quality, creative strategy and volume, portfolio shape across Advantage+, CBO, and ABO testing, allocation discipline, and measurement truth. “Creative is targeting” is a useful operating statement, not a reason to abandon exclusions, customer suppression, policy, unit economics, or experimentation.

Andromeda does not remove accountability. It makes the input quality more consequential. A wide portfolio of misleading claims, duplicate videos, weak landing pages, or low-quality conversion signals gives the system more ways to find the wrong outcome. Broad targeting succeeds when the creative truthfully distinguishes the intended buyer and the event returns a reliable quality signal.

## Optimizer review rules: bands, age gate, one change at a time

Added 2026-10-06 from the Tenfold `/meta-ads-launch` review. Every rule below is **[practitioner-consensus]**, not **[meta-official]**. `docs/META-ADS-ASSESSMENT-2026-09-14.md` found no official support for a 20% increase ceiling, so the step size is a default, not a law. These rules shape the *proposals* the optimizer writes. They never authorise a live change: `src/optimization-planner.js` emits `proposal_only` items and a human approves each one.

Enforcement status against `src/optimization-planner.js` at the time of writing:

| Rule | Already enforced in code | Doctrine only (apply by hand, candidate for the planner) |
| --- | --- | --- |
| Complete days only | Yes (recent window must end before today in the account time zone) | |
| No live mutation, proposals expire | Partly (`proposal_only`, `reviewAt` is 24h) | 48h expiry |
| Tracking-broke guard | Partly (`measurement_unverified` blocks) | Zero-conversion-across-all-campaigns check |
| CPA bands, age gate, one budget change per review, exact rollback, no-empty-campaign | No | All of them |

1. **One north-star number: target CPA.** Band every campaign by `r = window CPA / target CPA`: **WIN** `r <= 1.0`; **CLOSE** `1.0 < r <= 1.3` (leave alone, do not tinker); **OFF** `1.3 < r <= 1.5`; **WAY_OFF** `r > 1.5`. A campaign with spend and zero conversions has no CPA, so judge it by spend against 2x target CPA instead. The target itself must be an approved number in `data/STRATEGY.md`; if it is unconfirmed, report bands as "unconfirmed" and propose nothing.
2. **Complete days only.** Windows run through yesterday in the *account's* time zone, never today's partial day. Use 3d, 7d, 14d, 21d and life-of-campaign windows, and only the windows the campaign is old enough to fill. A 7d band on a 5-day-old campaign is a 5-day band and must say so.
3. **Age gate.** A campaign aged 0 to 2 complete days gets health checks only: disapprovals, zero impressions after 24 hours, spend above 1.5x its daily budget. No budget, pause or creative proposal on a campaign under 3 days old, whatever the CPA looks like.
4. **One budget change per campaign per review, at least 3 days apart.** Scale steps default to +20% and never past the account's daily cap (`META_ADS_MAX_DAILY_BUDGET_CENTS`). Never stack a bid change on a budget change (see the bidding ladder above).
5. **Rollback restores the exact previous value.** Read the prior budget from the change history and propose that number. A "-20%" rollback after a "+20%" lands at 96% of the original (1.2 x 0.8), not 100%.
6. **Never leave a campaign with zero active ads.** If a cut would empty the campaign, propose a pause of the campaign plus a request for new creatives instead. Pause, never delete.
7. **Tracking-broke guard.** If every managed campaign shows 0 conversions for 2 complete days while still spending, and the same campaigns had conversions in the prior 7 days, suspect the pixel, the checkout or the domain, not the ads. Propose nothing that cuts spend. Report "check Events Manager and the checkout path" and stop. This sits above the band logic in the decision hierarchy below (data integrity wins).
8. **Detect manual edits.** If a live budget differs from the last recorded state, treat it as a human change, record it as the most recent budget change (which restarts the 3-day clock in rule 4), and do not propose over it.
9. **Log every run** to a per-run markdown file under `data/optimization/` and let proposals lapse after 48 hours; a stale proposal is re-derived from fresh data, not re-approved.

Bands feed the existing kill rules; they do not replace them. A WAY_OFF campaign still has to clear the named kill rule above (3x spend, day-10 CPA, sustained 1.5-2x) before a pause is proposed.

## Weekly operating loop

1. Run `node src/index.js dashboard last_30d`, `node src/index.js insights last_7d`, and `node src/index.js insights last_30d` from `agents/meta-ads`.
2. Reconcile qualified revenue, CRM outcomes, refunds, survey evidence, and MER. Read `data/STRATEGY.md` before interpreting variance.
3. Diagnose in order: economics, tracking, structure, creative, page match, checkout or handoff, then attribution.
4. Name one binding constraint and no more than three testable actions. Give each a metric, guardrail, and kill date.
5. Seek approval for live changes. Log the approved action and reason. Read-only diagnosis is not authority to spend, pause, or activate.
