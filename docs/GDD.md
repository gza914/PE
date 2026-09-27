# Cartel Conquest — Game Design Document

Sep 27, 2026 · @Anthony Garza

## Overview

Cartel Conquest is a single-player grand strategy game: you play one cartel figure in a Sinaloa civil war and try to end the war in a stronger position than you started. It borrows Crusader Kings 3's structure (real-time with pause, character-driven, emergent stories) but compresses the scale to one state, a few months, and hours instead of years.

**Player fantasy.** You are not a general pushing armies across a map. You are a boss managing men, money, and information, where one careless convoy can cost you everything.

**Design pillars.** Every system should serve at least one of these.

1. **Information is the core resource.** You only see what your network sees, and everything you do can be seen. Convoys, drones, ambushes, the military, and propaganda all run on one visibility system.
2. **Logistics decide wars.** How you move matters as much as how many you move. Speed, stealth, and force trade off on every order.
3. **Characters, not units.** Every crew has a leader with traits, loyalty, and ambition. Men follow people and money, not flags.
4. **The war has a pulse.** Surges and lulls emerge from supply, exhaustion, and state pressure. Nothing is scripted to be quiet.
5. **Every choice costs.** Neutrality, alliances, bribes, and extortion all carry second-order effects the player must live with.

**Target.** A browser game built by Claude Code in TypeScript. One campaign runs 6–10 hours of play. Single player against AI-controlled characters.

## Setting and tone

The game is set in a civil war for control of Sinaloa between two factions of one cartel, modeled on the Chapitos–Mayos conflict. Real geography and real faction structure; fictional composite characters.

**Factions.** Starting territory is data-driven and editable, so it can be tuned for accuracy before release.

| Faction | Basis | Heartland at start | Character |
| --- | --- | --- | --- |
| Chapitos-side faction | The founder's sons' network | Northern Culiacán, the sierra (Badiraguato, La Tuna) | Younger, aggressive, media-savvy, stronger on firepower |
| Mayos-side faction | The old-guard network | Southern Culiacán, El Salado, the southern valley | Older, patient, deep local ties, stronger on halcones and politics |
| Outside cartels (non-playable) | CJNG-type rivals and smaller regional groups | Outside Sinaloa | Opportunists: offer alliances, then pursue their own agenda |

**Characters are fictional composites.** Real places and faction names stay. The people are invented, drawing on real archetypes. This protects the project on storefronts and against legal risk, and it frees the writing from real biographies.

**Playable characters.** Any faction head or lieutenant can be picked at start. The starting roster is 2 faction heads and 24–30 lieutenants.

| Start tier | Example | Difficulty | Why |
| --- | --- | --- | --- |
| Faction head | Leader of either faction | Hard | Highest profile, prime target for rivals and the military |
| City boss | The lieutenant holding Mazatlán | Medium | Rich and strong, but surrounded and visible |
| Town or ranchería jefe | The jefe of El Salado | Hard | Poor and small, but overlooked and flexible |

**Tone.** Grounded and procedural, not glamorous. Civilian cost is a visible system: closed businesses, emptied towns, and public anger feed back into income and recruitment. The game shows the logic of the war without celebrating it.

## Time and tempo

The game runs in real time with pause; one simulation tick is one in-game hour. A campaign lasts until an ending triggers, with a hard cap of 270 in-game days.

**Clock.**

- Speeds: pause, 1, 2, 3, 4, 5. Speed 1 is one game hour per 2 real seconds; speed 5 is one game hour per 0.1 seconds.
- Day and night: from 20:00 to 06:00, movement signature drops by 40%, but vehicle breakdown risk on brechas doubles.
- Weekly beat: payroll is due every Sunday at 00:00. Income settles daily at 00:00.
- Auto-pause fires on: a crew detected, a battle starting at one of your plazas, a character captured or killed, an event needing a decision, and payroll shortfalls. Each trigger can be toggled in settings.

**Travel reference.** Driving the full state takes about a day. Mazatlán to Culiacán is about 3 hours by highway and 8–10 hours on back roads. Exact times live in the road data.

**The pulse: why the war surges and goes quiet.** Lulls are not scripted. They emerge from three meters.

- **Faction Supply (0–100):** ammunition, cash reserves, and available men. Combat drains it by the hour. It regenerates from income.
- **Faction Exhaustion (0–100):** rises with casualties and consecutive days of heavy fighting. It decays by 3 per quiet day.
- **Regional Calentura (0–100):** state heat from violence. It drives military deployments (see The State).

The loop runs like this:

1. A faction with high Supply and low Exhaustion launches an offensive.
2. Fighting burns Supply, raises Exhaustion on both sides, and spikes Calentura.
3. High Calentura triggers a military surge: more checkpoints, patrols, and raids.
4. AI faction heads will not start a major offensive above 60 Exhaustion, and all offensives halt at 80. Crews pull back to regroup.
5. The state goes quiet except for rural skirmishes. Supply rebuilds, Exhaustion decays, the surge winds down.
6. Return to step 1.

**Culiacán never goes fully quiet.** The city has a minimum skirmish rate even during lulls. It is the permanent front.

**Regional war state.** Each region shows one of four states on the map: Quiet, Tense, Skirmishing, or Offensive. The state is computed from recent combat hours and troop concentration, and it tells the player at a glance where the fighting is.

## The map

Sinaloa is a stylized graph of about 50 nodes joined by typed roads, plus a Culiacán sub-map of about 16 colonias. It is a schematic, not GIS: node positions are approximate and drawn in SVG.

**Node types.**

| Type | Examples | Income | Defense | Notes |
| --- | --- | --- | --- | --- |
| City | Mazatlán, Los Mochis, Culiacán (sub-map) | High | High | Big extortion base, heavy military presence |
| Town | Guasave, Guamúchil, Navolato, Escuinapa, Cosalá | Medium | Medium | Route hubs |
| Ranchería | El Salado, La Tuna, Eldorado outskirts | Low | Low to high | Cheap to hold, often labs, hard to reach |
| Sierra hub | Badiraguato, Tamazula approach | Low | High | Production zone, near-invisible to the state |
| Port | Topolobampo, Mazatlán port | Very high | Medium | Precursor imports, heavy federal attention |
| Border exit | Sonora, Chihuahua, Durango, Nayarit edges | None | None | Trafficking route endpoints; outside cartels enter here |

**Plaza attributes (per node).** Owner, garrison crews, fortification (0–3), local support (0–100), halcón coverage (0–100), business count, lab count, military presence (0–3), and a list of claims other characters hold on it.

**Road types.**

| Road | Speed | Visibility | Checkpoint chance | Notes |
| --- | --- | --- | --- | --- |
| Highway (cuota or federal) | 1.0× | High | High | Fastest; armored trucks move freely |
| Paved secondary | 0.7× | Medium | Medium | The default compromise |
| Brecha (dirt) | 0.35× | Low | Very low | Slow, breakdown risk, ambush terrain; armored trucks cannot use it |

Each road segment stores its length in km, type, the nodes it passes near, and a terrain tag (open valley, sugarcane, hills, sierra) that modifies ambushes and combat.

**Culiacán sub-map.** The capital is its own graph of about 16 colonias joined by streets. Each colonia has a control value from −100 (fully Mayos) to +100 (fully Chapitos). A colonia flips owner when control crosses ±60, and the band in between is contested. At start, the north leans Chapitos, the south leans Mayos, and a central band is contested. The final colonia list and starting values will come from Tony.

**Map views.** The state view shows plazas, roads, known units, and war state per region. The Culiacán view shows colonias, the front line, and the crews committed there. A toggle overlays halcón coverage, calentura, and income.

## Visibility and intelligence

You only see what your network sees, and every move rolls against your enemies' network. This one system drives convoys, drones, ambushes, the military, and propaganda.

&#91;embedded content: detection flow · one road segment\]

A crew that passes a watched node rolls for detection. If spotted, the node's owner and allies get a report and can react; if not, the crew moves on to the next segment.

**Halcones.** Each plaza has halcón coverage from 0 to 100, which you buy with weekly pay. Coverage watches the node and the first 10 km of each road leaving it. Rivals can buy off your halcones, and military sweeps knock coverage down.

**Signature.** Every moving group has a signature.

```latex
\text{Signature} = \sum \text{vehicle signature} \times \text{road visibility} \times \text{night modifier} \times \text{crew stealth}
```

Vehicle signature is 1 for a pickup or SUV and 6 for an armored truck. Road visibility is 1.0 on highways, 0.6 on paved secondaries, and 0.25 on brechas. Night is 0.6, and an elite crew's stealth is 0.7.

**Detection.** Each watched node the group passes rolls once.

```latex
P(\text{detect}) = \text{clamp}\left(\text{Signature} \times \frac{\text{coverage}}{100} \times 0.08,\ 0.02,\ 0.95\right)
```

| Group | Road | Time | Signature | Detection per node at 80 coverage |
| --- | --- | --- | --- | --- |
| 50 pickups in one convoy | Highway | Day | 50 | 95% (capped) |
| 1 armored truck | Highway | Day | 6 | 38% |
| 10 pickups | Paved secondary | Night | 3.6 | 23% |
| 3 pickups, elite crew | Brecha | Night | 0.3 | 2% (floor) |

**Drones.** A drone scouts one road segment and reveals every unit on it for 4 hours. Each enemy crew on that segment notices it with a chance of its alertness × 0.5. How a crew reacts depends on its leader's traits.

| Leader trait | Reaction to a spotted drone |
| --- | --- |
| Paranoico | Relocates off the road immediately |
| Sanguinario | Digs in and waits in ambush |
| Calculador | Acts unaware, then shifts position, so your intel is now wrong |
| Default | Reports it and holds position |

**Fog of war.** Enemy positions you have seen become last-seen markers that fade after 12 hours. Every report carries a confidence level: confirmed, estimated, or rumor. Rumors can be false, and they can be planted (see Information warfare).

**Counter-intelligence.** You can hunt enemy halcones in your own plaza. It cuts their coverage there but raises calentura, and doing it heavy-handedly lowers local support.

## Units and logistics

The basic unit is the célula: a crew of 4–40 men under one leader character. How you split, route, and time your crews is the heart of the game.

**Célula attributes.**

| Attribute | Range | What it does |
| --- | --- | --- |
| Leader | A character | Traits shape behavior; death or capture shatters morale |
| Men | 4–40 | Combat strength and payroll cost |
| Skill | 1–5 | Combat multiplier and stealth; grows with battles survived |
| Gear | 1–5 | From basic rifles (1) to heavy weapons (5) |
| Morale | 0–100 | Below 30, the crew may break in combat or desert |
| Alertness | 0–100 | Chance to spot drones and ambushes |
| Ammo | 0–100% | Enough for about 6 hours of fighting; resupplied at owned plazas |
| Fatigue | 0–100 | Rises with travel and combat; recovers while garrisoned |

**Vehicles.**

| Vehicle | Seats | Signature | Roads | Notes |
| --- | --- | --- | --- | --- |
| Pickup | 4 | 1 | All | The workhorse |
| SUV | 5 | 1 | Highway, paved | Faster, blends into traffic in cities |
| Motorcycle | 2 | 0.3 | All | Fast on brechas; scouting and halcón duty |
| Armored truck (monstruo) | 6 | 6 | Highway, paved | Heavy combat bonus; very costly; a military priority target |
| Drone | — | — | — | Consumable; scouts one road segment |

A player starts with 0–3 armored trucks, depending on their starting character. Losing one should hurt for weeks.

**Orders.**

- **Move**, with a route choice: Fastest, Safest (lowest detection), or custom waypoints.
- **Sync arrival:** several groups ordered to reach one target at the same hour. The game computes each group's departure time.
- **Split and merge:** at any node you hold or occupy.
- **Escort:** attach an armored truck to a group of pickups.
- **Ambush:** hide on a road segment and strike the next enemy group that passes.
- **Patrol:** move back and forth on a segment, raising local detection.
- **Reinforce:** join a battle in progress at the destination.
- **Raid:** attack an enemy plaza.
- **Garrison:** defend a node and recover fatigue.
- **Lie low:** hide in a node with zero signature; the crew cannot act.
- **Retreat:** break off to the nearest friendly node.

**Supply lines.** Crews resupply ammo only at plazas owned by you or an ally. A crew sent far from home fights on what it carried. This makes distant reinforcement a real commitment.

**Example: reinforcing La Tuna from Mazatlán.** The player sides with the Chapitos, and La Tuna is under siege.

1. Drone scouts the brecha route through the sierra and spots a small enemy crew on one segment.
2. The elite crew (Skill 5, three pickups) takes the brecha at night, ambushes the small crew, and continues. Low signature, about 14 hours.
3. Two green crews (Skill 2, eight pickups) take the highway and paved roads, escorted by one armored truck. High signature, about 5 hours.
4. Sync arrival brings both groups in at 04:00, so the siege is hit from two directions at once.
5. The highway group is spotted twice. The enemy sets a roadblock, and the armored truck breaks through at the cost of heavy damage.

## Combat

Combat auto-resolves hour by hour with a live feed, and the player steps in at key decision points. There is no RTS micro: the skill is in arriving with the right force, at the right time, by the right road.

**Engagement types.**

| Type | Trigger | Typical length | Key modifier |
| --- | --- | --- | --- |
| Ambush | A group enters a segment with a hidden ambush | 1 hour | Attacker ×2.5 in the first hour |
| Road clash | Two hostile groups meet on a road | 1–3 hours | Terrain |
| Raid | Attack on a plaza with a light garrison | 2–6 hours | Fortification |
| Siege | Sustained assault on a fortified plaza | 1–5 days | Fortification, reinforcements, ammo |
| Urban skirmish | Culiacán colonia fighting | Continuous | Shifts control instead of ownership |
| Military clash | Any fight with army or Guardia units | 1–4 hours | State units rarely retreat; huge calentura |

**Crew power.**

```latex
\text{Power} = \text{men} \times (0.6 + 0.2\,\text{skill}) \times (0.6 + 0.2\,\text{gear}) \times \left(0.5 + 0.5\,\frac{\text{morale}}{100}\right)
```

An armored truck adds 30 power and absorbs the first losses of its side each hour. A side's power is the sum of its crews, multiplied by surprise, fortification (+25% per level for defenders), and terrain.

**Each hour of battle.**

1. Each side inflicts casualties equal to 4% of its power, times a random factor from 0.7 to 1.3.
2. Losses spread across crews in proportion to their size. Armored trucks take damage first.
3. Each crew loses morale in proportion to its losses. Below 30 morale it retreats; below 15 it routs, and some men are captured or scattered.
4. Each crew spends one hour of ammo. At zero, it must withdraw.
5. Reinforcements that arrived during the hour join at the start of the next one.

A battle ends when one side retreats, routs, is destroyed, or runs out of ammo.

**Sieges.** A siege has a progress meter. Attackers wear fortification down over hours, and the defender repairs it when not under pressure. Relief forces arriving mid-siege are often decisive: the La Tuna scenario is the core moment of the game.

**Player decisions mid-battle.** The feed pauses on key moments and offers:

- Commit reserves waiting nearby
- Send the armored truck forward (big damage, risk of losing it)
- Call for help from your faction or allies
- Withdraw in good order
- Accept a surrender and take prisoners

**Aftermath.** Casualties, captured characters, plaza control, calentura, reputation, and faction opinion all update. Captured characters trigger prisoner events: ransom, exchange, interrogation for intel, or execution. Execution raises fear and calentura and angers the victim's allies.

**Culiacán fighting.** Colonias do not flip in one battle. Each hour of superiority in a colonia shifts its control value by an amount set by the power ratio. A colonia changes hands only when control crosses ±60.

## Economy

Money is the war's fuel: income settles daily, payroll is due weekly, and an unpaid army changes sides. All figures below are in-game dollars and are starting values for tuning.

**Income.**

| Stream | Source | How it works | Main risk |
| --- | --- | --- | --- |
| Trafficking | Routes from sierra and ports to border exits | Each route has a daily value. Your cut is based on the route nodes you hold. Each contested node on the route cuts throughput by 20%. | Fighting and checkpoints choke routes |
| Tolls | Routes that pass through your plaza | Other groups pay to move product through your territory | Payers may decide taking your plaza is cheaper |
| Extortion (cobro de piso) | Businesses in your plazas | Businesses × rate × compliance. Rate is set per plaza: Low, Medium, High, or Brutal. | High rates close businesses and drain support |
| Labs | Lab count per node | Fixed daily output | Military raids destroy labs and seize product |
| Local rackets | Retail sales and other local rackets | Scales with plaza size and support | Low; steady but small |

**Extortion rates.**

| Rate | Income per business per day | Support per week | Businesses closing per week |
| --- | --- | --- | --- |
| Low | $20 | +2 | 0% |
| Medium | $40 | 0 | 1% |
| High | $70 | −4 | 3% |
| Brutal | $110 | −10 | 8% |

**Costs.**

| Cost | Starting value | When |
| --- | --- | --- |
| Payroll | $150 per man | Weekly |
| Halcones | $2,000 per 10 coverage points per plaza | Weekly |
| Ammo resupply | $30 per man per full reload | On resupply |
| Pickup / SUV / motorcycle | $15,000 / $25,000 / $4,000 | On purchase |
| Armored truck | $400,000 | On purchase; limited availability |
| Drone | $3,000 | Per use |
| Faction tribute | 20% of income | Daily, only if aligned |
| Bribes | Varies | See The State |

**Missing payroll.** One missed week drops every crew's morale by 20 and every leader's opinion of you by 10. Two in a row trigger desertions of 10% per day, and leaders become open to offers from rivals.

**Cash and stash houses.** Cash is held in stash houses in your plazas. Military raids and enemy captures seize it, so spreading cash across plazas is a real choice.

**Being aligned vs. neutral.** An aligned player pays tribute but can request cash, crews, and ammo from their faction head. A neutral player keeps everything and collects tolls from both sides while others bleed. Neutrality is profitable early and dangerous late (see Factions and diplomacy).

## Characters

Every faction head, lieutenant, crew leader, and key figure is a character with skills, traits, opinions, and a goal of their own. This is the CK3 layer: the war is fought by people who remember what you did.

**Skills (0–20).**

| Skill | Covers |
| --- | --- |
| Violencia | Combat bonus for crews they lead; intimidation |
| Astucia | Schemes, counter-intelligence, spotting betrayal |
| Negocio | Income from plazas and routes; smarter extortion |
| Palabra | Diplomacy, recruitment, holding loyalty |

**Other character data.** Age, health, faction, rank, home plaza, family links, profile (0–100), goal, and 3–5 traits.

**Profile.** High profile helps recruitment and intimidation, but draws military targeting and rival attention. Every public act raises it: big wins, executions, videos, and corridos.

**Traits.**

| Trait | Effect |
| --- | --- |
| Sanguinario | +Violencia, fear; raises calentura; others trust them less |
| Calculador | +Astucia; better schemes; slow to commit forces |
| Leal | Rarely defects; opinion decays slowly |
| Ambicioso | Pushes for promotion and territory; likely to scheme against superiors |
| Paranoico | Hard to scheme against; may purge their own people |
| Carismático | +Palabra; crews under them hold morale longer |
| Codicioso | +Negocio; easy to bribe; skims |
| Impulsivo | Attacks early and alone; strong ambushes, weak sieges |
| Discreto | Low profile growth; crews move with lower signature |
| Vengativo | Remembers slights forever; starts vendettas |
| Valiente | Crews hold under fire; leader death risk is higher |
| Cobarde | Retreats early; lower death risk |

**Opinion.** Every character holds an opinion of every other, from −100 to +100. It is the sum of modifiers, most of which decay over time. Examples: helped defend my plaza (+30, fades over 60 days); paid late (−10, fades over 30 days); killed my brother (−80, permanent).

**Relationships.** Blood family, marriage, compadrazgo, rivalry, and vendetta. Compadrazgo is a playable action: becoming someone's compadre creates a lasting bond with strong opinion bonuses on both sides.

**Goals.** Every AI character has a goal that drives their choices: take a neighbor's plaza, rise in the faction, get rich, stay alive, or avenge someone. Goals can change after major events.

**Schemes.** Schemes run over days and roll daily for progress and for discovery. Discovery reveals the schemer to the target.

| Scheme | Goal | Driven by |
| --- | --- | --- |
| Flip a lieutenant | Turn an enemy's man to your side | Palabra, money, target's opinion of their boss |
| Assassinate | Kill a character | Astucia, target's security and Paranoico trait |
| Frame | Make a faction or the military blame someone else | Astucia |
| Leak a location | Hand the military a rival's position | Astucia; raises risk of being named as a snitch |
| Buy their halcones | Take over a rival's coverage in a plaza | Money, Negocio |
| Compadrazgo | Build a lasting bond | Palabra, both sides' opinion |

**Death, capture, and succession.** Leaders can die in battle, be assassinated, be captured by rivals, or be arrested. An arrested character is jailed; they can be bribed out or broken out, or they are extradited after about 30 days and leave the game. If the player character falls, play continues as their designated heir or segundo. The heir inherits plazas and crews, but every leader's opinion drops by 20 and some may defect. With no heir, the game ends.

## Factions and diplomacy

Your first decision is whose side you are on, or whether you take a side at all. Every option pays and every option costs.

**Opening choice.** On day 0, the player declares for the Chapitos, declares for the Mayos, or stays neutral. Each starting character begins with a lean: an opinion bonus toward one faction based on history and family.

**Faction rank.** Aligned characters hold a rank: associate, lieutenant, senior lieutenant, or inner circle. Rank unlocks faction resources, a voice in faction war plans, and grants of captured plazas. Rank rises with faction opinion, battles won for the faction, and tribute paid.

**Faction requests.** Faction heads send duties: send crews to a battle, hit a target, pay a special levy, or hand over a suspected traitor. Accepting builds opinion. Refusing costs it, and repeated refusals mark you as unreliable.

**Staying neutral.**

- Both factions' opinion of you falls by 1 per day, down to −50.
- Neighbors build claims on your plaza over time. When a neighbor has a strong claim, a military edge, and their faction's blessing, they attack.
- Around days 14 and 30, faction heads send ultimatums: choose a side now, with better terms than you would get later.
- Late in the war, a desperate faction may offer kingmaker terms: large rewards for a neutral who joins at the right moment.

**Switching sides.** Your old faction marks you as a traitor (−100 opinion, permanent). Leaders under you who were loyal to that faction may defect. Your new faction starts suspicious (−20), but you negotiate terms: keep your plazas, and claim an enemy plaza or two.

**Pacts between characters.**

| Pact | Effect | Can cross faction lines? |
| --- | --- | --- |
| Non-aggression | Neither attacks the other's plazas | Yes, secretly; discovery angers your faction |
| Safe passage | Crews move through the other's territory unhindered | Yes, secretly |
| Mutual defense | Each is asked to reinforce the other when attacked | No |
| Joint attack | Take a plaza together and split it | No |
| Route share | Split trafficking income on a shared route | Yes |
| Local truce | Stop fighting in one area for a set time | Yes; common during lulls |

**Foreign alliances.** Outside cartels, modeled on groups like CJNG, can be approached by any character, including AI faction heads. That means an AI faction can bring in outsiders and reshape the war.

| They offer | They take |
| --- | --- |
| Crews, often high Skill | A 25–40% cut of routes through your territory |
| Weapons (gear upgrades) and armored trucks | Their people inside your plaza, with their own halcones: they see everything you do |
| Cash advances | Loyalist backlash: a "sold out" opinion penalty from Sinaloa characters |

Every foreign ally has an ambition meter on your plaza. It grows while they are strong and you are weak. When it peaks, they stop being your ally and start being your next war.

**Ending the war by negotiation.** When both factions stay above 70 Exhaustion for 14 days, faction heads can open truce talks. Aligned players of high rank get a say in the terms.

## The State

The state is a third force that answers violence with pressure. It cannot be beaten, only bribed, used, dodged, or provoked.

**State actors.**

| Actor | Role in game | Bribable? |
| --- | --- | --- |
| Army | Deployments, raids on labs and stash houses, capture operations | Local commanders, temporarily |
| Guardia Nacional | Highway checkpoints and patrols | Yes, per region |
| State and municipal police | Local presence; a source of tips both ways | Easily; often already on someone's payroll |
| Federal prosecutors | Build cases on high-profile characters; extraditions | Rarely; very expensive |

**Calentura.** Each region has a heat level from 0 to 100. Battles, executions, civilian deaths, attacks on state forces, and viral videos raise it. It decays by 2 per quiet day.

| Calentura | State response |
| --- | --- |
| 0–30 | Normal: a few checkpoints on main highways |
| 30–60 | Elevated: more checkpoints and patrols; brecha checkpoints appear |
| 60–85 | Surge: army deployment, raids on labs and stash houses |
| 85–100 | Occupation: signature ×1.5 for every group, capture operations on top targets |

**Player options.**

| Option | Effect | Risk |
| --- | --- | --- |
| Bribe a commander | Fewer checkpoints and slower raids in one region for 30 days | Commanders rotate about every 45 days; the bribe is lost |
| Bribe police | Tips about army operations; a bonus to halcón coverage | Police sell tips to rivals too |
| Anonymous tip-off | The army raids a rival's position or stash house | A rival with high Astucia may trace it back to you |
| Hand over a scapegoat | Drop calentura in a region fast | Opinion hit with the scapegoat's friends and family |
| Lie low | Your plazas' calentura decays twice as fast | Income drops while you wait |
| Fight | Ambush patrols or break checkpoints | +30 calentura and a statewide surge |

**Capture operations.** Characters with profile above 70 accumulate a state intel meter. Leaks, captured men who talk, and informants fill it; safehouses and escort crews slow it. At 100, the state launches a capture operation, and the player chooses to fight, flee, or surrender. Surrender means jail, then bribery, escape, or extradition within about 30 days.

**Outside pressure.** Periodic events represent federal and foreign pressure: extradition pushes, high-profile arrests, and politically driven crackdowns. They shift calentura statewide and can remove characters from the board.

## Information warfare

Messages are weapons: they move morale, recruitment, public support, and what your enemies believe they know. This layer is the game's signature feature and its main authenticity lever.

**Reputation meters.**

- **Fear** (per character): how much civilians and rivals avoid crossing you. Raises extortion compliance.
- **Respect** (per character): standing among other narcos. Drives recruitment and faction opinion.
- **Credibility** (per character): whether people believe your messages. Every lie that is exposed lowers it.
- **Public support** (per plaza): how much locals tolerate you, tip you off, or turn you in.

**Actions.**

| Action | Reach | Effect | Cost and risk |
| --- | --- | --- | --- |
| Narcomanta | One plaza | Claim territory, threaten, or accuse a rival; +fear, rival opinion −10 | Small calentura |
| Video message | Statewide | Big morale swing for your side or the target's; +profile | High calentura and profile |
| Social media claim | Statewide | Claim a victory or the enemy's weakness; moves faction morale | False claims can be exposed, costing credibility |
| Commissioned corrido | Statewide, slow | Lasting +respect and recruitment | Money and profile; attracts state attention |
| Planted rumor | One rival | Feeds false intel into their fog of war: a fake convoy, a fake weakness, a fake betrayal | Discovery lowers credibility and angers the target |
| Show of force | One plaza and roads | Deliberately high-signature parade; +fear and recruitment | Big calentura; tells everyone where your crews are |

**Exposure.** A rival with high Astucia can debunk your false claims with a counter-message. Exposure drops your credibility, which weakens every message you send afterward.

**Baiting.** Planted rumors and false claims are how a weaker player wins. Convince a rival your plaza is defenseless and they overcommit into an ambush. Convince a faction head their lieutenant is talking to the other side and they purge him for you.

**Presentation.** Messages appear as text and outcomes: the wording of a banner, a summary of a video's reach, a corrido's title. No graphic media.

**Content.** Message templates, banner wording, corrido titles, and rumor text live in data files. Tony writes this library; it is where the game's authenticity comes from.

## Event system

Events are the game's storytelling engine and its easiest place to add depth. Each one is a data file with a trigger, a description, and options with effects, in the Paradox style.

**Structure.** Every event defines an id, a scope (character, plaza, faction, or region), trigger conditions, a mean time to happen in days, text with variables, and 2–4 options. Each option has optional conditions, effects, and an AI weight so AI characters can take the same events.

```json
{
  "id": "lab_raid_warning",
  "scope": "plaza",
  "trigger": { "owner_is_player": true, "labs_gt": 0, "calentura_gt": 60 },
  "mean_days": 10,
  "title": "A friend in the police",
  "text": "A contact in the {plaza.name} police says the army is planning a raid on your lab within 48 hours.",
  "options": [
    { "label": "Move the lab to the sierra", "effects": { "money": -40000, "labs_move_to": "nearest_sierra_owned" }, "ai_weight": 3 },
    { "label": "Pay the contact to delay the raid", "effects": { "money": -25000, "delay_event": "army_lab_raid", "delay_days": 14 }, "ai_weight": 2 },
    { "label": "Ignore it", "effects": { "schedule_event": "army_lab_raid", "in_hours": 48 }, "ai_weight": 1 }
  ]
}
```

**Pacing.** The target is 2–4 player-facing events per in-game week, rising during surges. Events from the same chain never fire back to back.

**Starter event list.** Around 40 events for the first playable build; these show the range.

| Event | Trigger | Choices |
| --- | --- | --- |
| A lieutenant's son is killed | Family member dies in battle | Avenge now, avenge later, or buy peace |
| Army finds your lab | Calentura surge plus labs | Fight the raid, abandon it, or bribe |
| Rival offers a local truce | Both sides exhausted in a region | Accept, accept and betray, or refuse |
| Outside cartel envoy arrives | Player losing ground or neutral | Hear terms, refuse, or report to faction |
| Your halcones were bought | Rival completes the scheme | Purge, feed them false intel, or buy back |
| Payroll convoy robbed | Cash moved on a watched road | Hunt the robbers, eat the loss, or blame a rival |
| Commander rotation | 45 days since bribe | Bribe the new one, test them, or wait |
| A corrido about you goes viral | High respect plus commissioned corrido | Embrace it or suppress it |
| Crew leader wants a promotion | Ambicioso leader, high skill | Promote, pay off, or put down |
| Civilians killed; your crew blamed | Battle in a populated node | Deny, blame the rival, or pay families |
| Priest offers to mediate | Long fighting in one town | Accept talks, refuse, or use talks as cover |
| Captured man is talking | Your man held by the army | Get him out, silence him, or relocate |

## AI

AI characters use a simple utility system: score every available action, pick the best one above a threshold. This is achievable for Claude Code and easy to tune; anything fancier is out of scope.

**Three layers.**

| Layer | Who | Decides | How often |
| --- | --- | --- | --- |
| Strategic | Faction heads | War plan: attack a region, defend, or regroup; requests to lieutenants; outside alliances; truce talks | Every 24 game hours |
| Operational | Lieutenants | Answer requests, pursue their goal, defend plazas, set extortion, run schemes, pick sides if neutral | Every 6 game hours, staggered |
| Tactical | Crew leaders | Route choice, when to retreat, how to react to drones and ambushes | On movement and in battle |

**Scoring.** Each action's score is its expected value, times weights from the character's traits and goal, minus a risk term scaled by their personality.

```latex
\text{Score} = \text{value} \times \text{trait weight} \times \text{goal weight} - \text{risk} \times \text{caution}
```

An Impulsivo lieutenant has low caution and scores raids high. A Calculador one has high caution and scores schemes and waiting high. Weights live in a JSON file for tuning.

**No cheating on information.** AI characters see only what their own halcones and drones see. This keeps ambushes, rumors, and baiting fair: the AI can be fooled exactly like the player can. Difficulty changes AI income and starting strength, never their vision.

**Faction war plans.** A faction head picks a focus region based on Supply, Exhaustion, and the value of targets. The head then sends requests to lieutenants nearby. This is what makes the war feel coordinated, and it drives the surge-and-lull pulse from the faction side.

**Risk.** AI is the project's biggest technical risk. The fallback is scripted faction plans for the first build, with utility AI replacing them in a later phase.

## Endings and scoring

You win by ending the war in a better position than you started, not by conquering Sinaloa. The final score measures improvement over your starting character.

**End triggers.**

| Trigger | Condition |
| --- | --- |
| Faction collapse | A faction head is killed, captured, or extradited and no successor holds the faction together within 7 days |
| Territorial defeat | A faction holds under 20% of total plaza value for 14 days |
| Negotiated truce | Both factions stay above 70 Exhaustion for 14 days and the heads agree to terms |
| Time cap | Day 270 |
| Player eliminated | Player character dies with no heir, or is extradited with no heir |

**Score.** Each category compares your end state to your start.

| Category | Measures | Weight |
| --- | --- | --- |
| Territory | Total plaza value held | 30% |
| Wealth | Cash plus assets (labs, vehicles, stash houses) | 20% |
| Standing | Rank in your faction, weighted up if your faction won | 20% |
| Reputation | Respect | 15% |
| Force | Crew strength at the end | 15% |

A final multiplier applies for your character's fate: alive and free ×1.0, jailed ×0.5, and dead or extradited ×0.25 (the heir keeps the rest).

**Epilogue.** A CK3-style ending screen shows your title and the fates of the key characters you dealt with.

| Title | Condition |
| --- | --- |
| El Patrón | Top score and on the winning side, or top score as a neutral |
| Kingmaker | Joined late and decided the war |
| Survivor | Kept your plaza and your freedom |
| Pawn | Lost ground but survived |
| Corrido | Died, but with top respect |
| Extradited | Taken out of the game by the state |

## UI and UX

The map is the game; everything else is a panel over it. The target is a desktop browser first, at 1280×720 and up.

**Main layout.**

- **Top bar:** date, time, speed controls, cash, your faction's Supply and Exhaustion, and calentura in your home region.
- **Center:** the map, with a toggle between the state view and the Culiacán view.
- **Left panel:** details on whatever is selected (a plaza, crew, or character) with its actions.
- **Right panel:** the report feed. Halcón sightings, battle updates, requests, and event notices, newest first, each clickable to jump to its location.
- **Map overlays:** halcón coverage, calentura, income, war state, and faction control.

**Route planning is the key interaction.** Select a crew, click a destination, and the game shows three routes (Fastest, Safest, and a middle option). Each is drawn on the map with its ETA and an estimated detection risk. The estimate uses only what you know, so bad intel gives a bad estimate. Shift-click adds custom waypoints.

**Screens.**

| Screen | Purpose |
| --- | --- |
| Character select | Pick a start; see skills, traits, plazas, crews, and faction lean |
| Plaza panel | Garrison, fortification, support, extortion rate, labs, halcones, claims |
| Crew panel | Stats, vehicles, ammo, orders |
| Character panel | Skills, traits, opinions (with modifier breakdown), relationships, schemes |
| Battle feed | Hour-by-hour log, both sides' power, decision prompts |
| Faction screen | Rank, requests, faction meters, war plan |
| Diplomacy screen | Pacts, offers, foreign contacts, ultimatums |
| Intel ledger | All reports with confidence and age; last-seen markers |
| Economy ledger | Income and costs by plaza and route; payroll forecast |
| Messages | Compose narcomantas, videos, claims, and rumors |
| Event popup | Title, text, options with a hover preview of effects |
| End screen | Score breakdown, title, and character fates |

**Notifications.** Three tiers: critical (auto-pause, center popup), important (feed plus a sound), and routine (feed only). Every opinion value and meter has a hover breakdown showing why it is what it is, as in CK3.

**Visual style.** Flat, dark map with muted terrain, sharp faction colors, and monospace report text that reads like intercepted messages. SVG throughout, so no art assets are required for the first build.

## Technical architecture for Claude Code

Build a browser game in TypeScript with a pure, deterministic simulation core and a React UI on top. No game engine is needed: the map is SVG and combat is resolved, not animated.

&#91;embedded content: architecture · sim core, state, UI, commands\]

The simulation core loads content, advances one hour per tick, and writes a single game-state object. The UI only reads that state and sends commands, which the core applies at the next tick.

**Stack.**

| Piece | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | Types catch data mistakes across many systems |
| Build | Vite | Fast, simple, static output |
| UI | React | Panels, feeds, and popups |
| UI state bridge | Zustand | Lightweight subscription to game state |
| Map | SVG with pan and zoom | Crisp, no art assets needed |
| Data validation | Zod | Content errors fail loudly at load |
| Tests | Vitest | Unit tests and headless sim runs |

**Core rules for the build.**

1. The sim is pure TypeScript with no DOM access, so it runs headless in tests.
2. It is deterministic: the same seed and the same commands always produce the same game.
3. All game state is one plain, serializable object.
4. The UI never changes state directly. It sends commands to a queue.
5. Every number that affects balance lives in tuning.json, not in code.
6. Content (map, characters, traits, events, messages) is data, validated at load.

**Folder structure.**

```
/src/sim        state.ts, tick.ts, rng.ts, commands.ts
/src/sim/systems  movement, detection, combat, economy,
                  characters, schemes, ai, state, infowar, events
/src/ui         app shell, panels, feed, popups
/src/ui/map     state view, Culiacán view, overlays, route planner
/src/data       map.json, roads.json, colonias.json, characters.json,
                traits.json, tuning.json, messages.json, events/*.json
/tests          unit tests, headless campaign runs
```

**Key data types.** Node, Road, Colonia, Character, Crew, Vehicle, Faction, Pact, Scheme, Report (intel with confidence and age), Battle, Event, and Command.

**Save and load.** Saves serialize the game state plus the RNG state to JSON. They are stored in browser storage and can be exported and imported as files.

**Performance budget.** About 50 nodes, 16 colonias, 30 characters, and 100 crews. At top speed that is 10 ticks per second, which is comfortably within a browser's limits.

**Developer tools.** A debug overlay that lifts fog of war, a seed input, a command log, and a headless AI-vs-AI campaign runner. The runner simulates 270 days in seconds and reports balance stats: war length, casualties, and how often each faction wins.

## Build roadmap

Build in five phases, logistics first, because the convoy-and-detection layer is what no other game does. Each phase ends in something playable and a gate it must pass before the next starts.

&#91;embedded content: build roadmap · 5 phases, 5 gates\]

Phases 1 and 2 prove the core fantasy on their own. Phases 3–5 turn a tactics toy into a full campaign.

**Out of scope for version 1.** Multiplayer, 3D or animated combat, voice or video media, a mobile layout, and procedurally generated maps. Each could come later without changing the architecture.

**How to hand this to Claude Code.**

1. Give Claude Code this whole document, and ask it to scaffold the project and data schemas first, with no gameplay.
2. Build one phase per session or series of sessions. Start each with this doc and the current repo.
3. Ask for headless tests for every system before its UI.
4. At each gate, play the build, and update this doc with what changed.
5. Supply the content files (map positions, colonias, characters, messages, events) as JSON as each phase needs them.

## Balance targets and open questions

Every starting value in this document goes into tuning.json. The headless AI-vs-AI runner checks the targets below, so balance is measured, not guessed.

**Balance targets.**

| Target | Goal |
| --- | --- |
| War length | Median of 120–200 days; under 10% of runs hit the 270-day cap |
| Pulse | At least 3 statewide quiet stretches of 5+ days per campaign |
| Faction balance | Each faction wins 40–60% of runs |
| Neutral risk | About half of neutral lieutenants still hold their plaza on day 60 |
| Convoy trade-off | A 50-truck highway convoy is detected on over 90% of trips; a small elite crew on brechas at night on under 15% |
| Money pressure | A typical lieutenant faces at least one payroll shortfall per campaign |

**Open questions.**

- [x] Final Culiacán colonia list and starting control values: first draft in `colonias.json` (16 real colonias; review)
- [x] Starting plaza ownership across the state: first draft in `map.json` (48 nodes; review)
- [x] The 30-character roster: first draft in `characters.json` (2 heads, 24 lieutenants, 5 crew leaders; review)
- [ ] Faction names in game: real names or lightly fictionalized? (working names: Chapitos, Mayos)
- [x] Message library and the 40 starter events: first drafts in `messages.json` (40) and `events/` (44); review
- [ ] Final title: keep Cartel Conquest?
- [ ] Where it will be released (itch.io, Steam), which sets the content review bar

## Build log

**Phase 0: scaffold.** Project, data schemas, content loader, deterministic tick, save/load, UI shell.

**Phase 1: logistics and detection.** Built:

- Route planner with Fastest, Balanced, and Safest options and custom waypoints. Risk estimates use only the planning network's knowledge: rival halcón coverage is assumed (`detection.assumedUnknownCoverage`) until intel says otherwise.
- Hourly movement with road speeds, vehicle road limits, brecha breakdowns (doubled at night), sync arrival, escorts, split and merge, retreat to the nearest friendly plaza, and road stations for Ambush and Patrol.
- Detection exactly as specified: one roll per watched node passed, on approach inside the halcón road-coverage zone. Crews sitting in a watched spot re-roll daily, patrols watch their segment hourly, and drones reveal a segment for 4 hours, with trait-driven reactions when a crew notices one.
- Fog of war: networks (a faction, or a neutral character alone) share reports; last-seen markers fade after 12 hours; halcón sightings are estimates (±25% men), drone and patrol sightings are confirmed.
- Scripted AI logistics traffic (the fallback named under AI): AI lieutenants send small crews on supply runs between friendly plazas and bring them home.

Design decisions made during the build:

- Crew stealth scales with skill (`detection.stealthBySkill`, 1.0 → 0.7); the Discreto trait multiplies signature by 0.8.
- A crew moving with escorts is seen as one group with a summed signature.
- Vehicle speeds were tuned so Mazatlán–Culiacán takes about 3 hours by highway.
- Measured against the convoy balance target: a 50-truck highway convoy is detected on 100% of test trips; an elite 3-pickup crew on brechas at night on about 6%.

