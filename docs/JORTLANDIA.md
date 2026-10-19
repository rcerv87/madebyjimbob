# Jortlandia: game design and build plan

Ruben's game design (2026-10-15, from the doc "Jortland: Gamification Design",
https://claude.ai/artifact/FwR1aLxKAgP1fgeShjprqw), brought into the repo on 2026-10-18. Part 1 is the design as he
wrote it. Part 2 is how it gets built on MadeByJimBob: what it reuses, the rules that need an answer first, and the
releases (epic 9, MBJ-901 to MBJ-922 in `BACKLOG.md`; the engine in ADR-015). Nothing is built yet.

The phone apps already carry the name (Jortlandia in both stores, ADR-014). The game is a section of the same site
and apps, not a separate app.

# Part 1: the design (Ruben, 2026-10-15)

## Overview

Jortlandia is a persistent, text-based multiplayer strategy game built into JB's channel, like a long game of Risk or
Age of Empires played the way 1980s and 1990s BBS games were: menus and typed commands.

It's a feudal land. Your membership tier is your social class, and watching the streams is how you survive, scheme
and rise.

- **Format:** command prompts and menus, no AI narrator
- **Where:** its own screen, plus a retro map overlay that pops out beside the stream
- **Currency:** Jort Coin
- **Pacing:** the world never resets; seasons rebalance power

## Classes and hierarchy

Your membership tier is your class: free members are peasants or illegals (assigned at random), lower tiers are
citizens, high tiers are lords.

Loyalty runs up to the Emperor; renters stand outside it:

```
Emperor · JB              revives, cures, pardons anywhere, triggers events
  ^ pledge to
Crowns (2-4) · players    set laws, approve projects, pardon within kingdom
  ^ pledge to
Lords · high tier         start with 100 lots; collect taxes and decrees;     --exile-->  Crownless lords
                          can be criminals with no penalty                                own laws, much lower
  ^ sworn to                                                                              revolt threshold
Citizens · lower tier     own 1 lot, choose a job, pay or evade taxes         <--rent---  Peasants and illegals · free
                                                                                          rent only; random job and
                                                                                          stats; no pledge; move
                                                                                          between kingdoms
```

Only lords can own many lots or grant land. Renters owe no loyalty, which is both their weakness and their freedom.

## Land and map

The world is 100,000 lots, and 1 lot is 4 parcels. New land opens only if Jortlandia becomes extremely popular.

| Class | Land |
| --- | --- |
| Lords | Start with 100 lots; can buy more and grant land to others |
| Citizens | Own 1 lot (4 parcels) |
| Peasants and illegals | Rent only |

**Map**

- Retro style, pops out beside the stream
- Zoom from kingdoms to fiefdoms to parcels; tap a parcel to see its owner, renter, buildings and history
- Vacant lots can be moved into or bought
- Public places (shops, taverns) are open to all; homes are private
- Common risks show as a map layer; hidden traits are found by a surveyor or high Perception

**Resources and risks**

- Each lot has resources (farmland, timber, ore, water, herbs) and risks (flooding, hurricanes, plague, fire)
- Resources renew slowly; overuse depletes a lot for a season
- Low-reputation areas become the bad part of town: less tax, less protection, worse sanitation, more disasters

**Improvements**

- Land can be improved (dams, walls, wells), but effects ripple: a dam that helps one kingdom can cause drought in
  another, and that can mean war
- Big projects are the crown's call; a lord who fully owns a resource can act alone, at a loyalty cost
- A crown can force a lord to undo a project, at a loyalty cost

**Cleaning up an area**

- Lords fund police, sanitation and doctors; players must fill those jobs, for duty (reputation and loyalty) or money
- Unfilled posts change nothing

## Economy and laws

Everyone is paid a biweekly wage in Jort Coin. Free members' wages barely cover food, care and housing, so they live
close to death.

**Money flows**

- **Rent:** paid to whoever owns the lot
- **Taxes:** citizens pay their lord; citizens can choose to evade, which hurts reputation if caught
- **Lords' income:** taxes plus decrees: special levies, fines, seizure (felons, the dead without wills, traitors),
  tolls, and trade monopolies
- **Limit:** heavy decrees raise unrest and push a fiefdom toward revolt
- **Services:** doctors for health, lawyers and judges for jail, bankers for insurance

**Laws**

- Crowns, and crownless lords, set laws from a fixed menu
- Laws can change once a month, announced on the ticker
- Laws are public on each kingdom and fiefdom page

| Law area | Options |
| --- | --- |
| Taxes | None, low, standard, high |
| Crime | Strict, lenient, legalized (drugs, forgery, smuggling) |
| Punishment | Fines, jail, exile, execution |
| Immigration | Open to illegals, citizens only, closed |
| Rebellion | Amnesty, trial, execution on sight |
| Land | Squatting allowed or banned, renter protections |
| Health | Free doctors, paid only, plague quarantine |

Lenient laws lower revolt risk but raise crime; harsh laws do the reverse. Laws also drive migration, since renters
move wherever life suits them.

## Characters

Every player has seven stats that gate seven skill trees. Stats never grow; they only change through a reskill.

**Stats:** Charisma, Dexterity, Perception, Intellect, Strength, Endurance, Cunning. Cap of 10 per stat; all-in builds
are allowed.

|  | Paid members | Free members |
| --- | --- | --- |
| Starting points | 10, chosen | 7, random |
| Race | Chosen | Random |
| Job | Chosen within skill level | Random, one reroll a month |
| Reskill | Once a month | Not chosen |

Race adds bonuses to some stats and penalties to others (list still open). On upgrading, a free member chooses to
respec with 10 points or keep their build and add 3.

**Skill trees**

- 5 skills per tree, needing 2 / 4 / 6 / 8 / 10 in that stat
- Reaching a skill isn't enough; it must be earned with XP or Jort Coin, and each costs more than the last
- Job work earns XP for the stats that job uses (e.g. doctor work → Dexterity and Intellect)
- **Passive** skills affect only you and are always on; **active** skills affect others and cost coin with cooldowns
- A reskill wipes all earned skills

| Stat | Example skills | Capstone (10) |
| --- | --- | --- |
| Charisma | Pick the duel game when you out-charm a rival, refuse duels free, resist interrogation | Mind Control: force a player to act |
| Dexterity | Faster timed games, pickpocket, escape artist, surgeon jobs | Ghost Hands: steal undetected |
| Perception | Hints on who's a criminal or loyalist, spot hidden treasure, detect undercover police | All-Seeing: view a full hidden card |
| Intellect | Reveal a battleship square, better trial defense, banker and judge jobs | Mastermind: a plan that can't leak |
| Strength | Labor pay, carry more, soldier jobs, hold land in conflicts | Warlord: take land without declaring war |
| Endurance | Slower health loss, disaster resistance, shorter jail, survive a duel loss | Undying: survive one death a season |
| Cunning | Evade capture, less heat, hide inventory from looting | Kingmaker: secretly rig a revolt |

Capstones are secret; the ticker reports only their effect.

**Stat card**

- **Public:** name, avatar, class, kingdom and lord, legit job, level, reputation label, status (alive, dead, jailed,
  felon, exiled), land, shop, badges, duel record
- **Private:** exact health and reputation, loyalty, criminal level, heat, inventory, coin, skills, reskill date, will,
  insurance, known affiliates, rumors heard
- **Lifetime record (always public):** deaths, revives, jailings, duels won and lost, times a lord or crown, revolts,
  treasures found, days survived, wars fought

## Jobs and crime

Every job has a dark side, and no criminality is ever healthy: it always costs.

**Jobs:** garbage man, doctor, pharmacist, surgeon, artist, police, military, banker, lawyer, judge, surveyor, shop
owner and more. Each needs minimum stats (a surgeon needs Dexterity). Player shops can be legit or fronts.

**Dark skills**

- Every skill has a dark counterpart, available whenever you have the normal one
- Dark skills are always active, never passive: each use is a choice with risk
- Examples: dark doctor revives the dead, pharmacist sells drugs, artist forges documents, police take bribes,
  military become hit men, bankers sell fake insurance, surveyors lie
- Each use costs reputation, raises heat, and risks capture; criminals die faster, citizens included
- Lords can be criminals with no penalty

**Criminal status (private)**

- Levels rise with dark skill use
- At a set level, **Go Straight** unlocks: a heavy fee, then status falls slowly
- A crime while going straight doubles the reputation penalty
- Felons have limited legit jobs

**Secrecy and rumor**

- No one wears a criminal label; status is read through rumors and Perception
- Revealing criminality to the wrong person can mean jail
- Asking a non-criminal about a crime costs reputation and can get you reported for solicitation

**Organizations**

- Groups can form gangs or syndicates
- When a member is caught and interrogated by someone with higher Charisma, they must give up at least one known
  affiliate; the lower the interrogator's Charisma, the better the odds of staying silent
- A flip can bring down the whole group, up to execution

**Protection**

- Can be bought or granted (guards, police, a lord's shield)
- Bosses (lords, crowns, mob bosses) get protection
- Protectors can be bribed, so trust still matters

## Loyalty and power

One loyalty system runs at every level: citizens to lords, lords to crowns. Anyone can refuse, defect, ally or rebel
under the same rules.

**Rebellion**

- Fostered in secret, recruit by recruit, like crime
- Pitching it to a loyalist gets you caught and tried before the lord
- The lord rules: mercy, jail, fines or execution; an unpopular verdict lowers citizen loyalty
- A lord can secretly plot against their crown

**Defection and exile**

- A crown that pushes a lord too hard risks defection, and a pressured lord can seek an alliance with another kingdom
- Escalation runs diplomacy first, then force
- A defecting lord keeps only the land they can hold; citizens can refuse to follow
- Abandoned land is open to claim
- An exiled lord has no crown and must petition other crowns for status
- A lord can stay crownless forever and set their own laws from the menu, but with a much lower revolt threshold

**Crowns**

- Worn by players; a crown can fall to revolt, conquest or death, and that kingdom's lords choose the successor
- "The government" is each crown's enforcers (players), plus the Emperor's system agents who hunt contraband holders

**Pardons:** lords within their fiefdom, crowns within their kingdom, JB anywhere.

## Death, jail and duels

Death lasts one month and resets your status, treasure and land unless you're insured.

**While dead**

- Live chat shows you in red; anyone who interacts with you loses reputation instantly
- Only live streams are watchable: no replays or archive
- You can still chat on live
- You earn a permanent necromancy badge
- Paid perks outside the game are kept

**Coming back early**

- Only a dark doctor (a dark skill) can revive you; JB can revive anyone
- A free member revived early comes back as a **zombie** until the month ends or JB cures them: lower or decaying
  health, reputation contagion, grim jobs only, green or gray chat name, can spread plague

**Jail**

- Works like death: restricted actions and a reputation hit
- Paid lawyers and judges can get you out
- Released players are felons with limited jobs
- A felony clears only on death, or instantly with a pardon

**Protecting what you have**

- **Wills:** paid; you choose who gets your things; final, never contested
- **Insurance:** bought from a banker to protect some of your holdings

**Duels**

- Always to the death; the winner loots the loser
- Played as mini-games: tic-tac-toe, battleship, rock-paper-scissors and more
- Higher Charisma lets the challenger pick the game
- Skills can let you survive a loss (still looted) or hide items from looting; full protection means stacking both

## Treasure and items

The whole site is seeded with Easter eggs, trials, scavenger hunts and treasure hunts, and everyone can play.

**Where things hide**

- In old streams, as objects at a timestamp
- In live streams
- Buried in Jortlandia parcels, found with a minesweeper-style dig
- Started by JB's mock ads in his streams

**Items**

- Some are one of a kind; some have limited copies
- Players can trade, sell and gift items, and sell to shops
- A free member who finds something valuable can sell it and pay a forger for an ID to climb in status

**Conspiracy items**

- Joke "proof" items: demolition schematics, assassination receipts, flat earth photos
- High value, but holding one raises heat and can make you a government target to be silenced

**The dead** aren't barred from hunting, but with no clues or archive access they effectively can't.

## Events, wars and seasons

**World events:** revolts, plagues and acts of God (floods, hurricanes, fires, famine, earthquakes).

- The system runs plagues and disasters from land risk and sanitation; JB can trigger any event live
- Some events start from stream moments, like a catchphrase or a mock ad
- Plagues spread by contact and hit free members hardest

**War**

- Diplomacy first, then force
- War is a timed campaign (e.g. one week); soldiers (players in military jobs), Jort Coin spent on supplies, and land
  held decide who takes the contested lots

**Seasons**

- The world never resets; each season nudges power back toward balance
- If one crown gets too strong, the next season gives some lords incentives to revolt, annex land and become crowns
- No overall winner; each season crowns a top kingdom and top players
- Prizes: physical merch, and possibly custom avatars drawn by JB

## Stream integration

The stream is part of the map: watching pays, clues come from JB's content, and game status follows you into chat.

**Watching rewards:** XP toward skills and some Jort Coin. Live pays more than replay; hunts and drops pay most.

**Three chats**

| Chat | Where | Notes |
| --- | --- | --- |
| Live chat | Live streams | Merged with YouTube and Rumble; dead players show in red |
| Replay chat | Old streams | Original chat replays in sync; members add their own |
| Jortlandia chat | Game screen | Split by location (Tavern, Market, fiefdoms); crimes and deals happen here; mods handle real rule-breaking only |

**News ticker**

- Raids, deaths, executions, finds, plagues, revolts, wars and capstone effects scroll at the bottom of every stream
  (e.g. a front busted in a player's kingdom)
- Collapsible: hidden, a thin line, or an expanded feed; JB can force it open for big moments
- No bribes to stay off it; a dark Cunning skill can plant fake headlines

**Mock ads**

- JB records them; Studio tags each with its hunt and timestamp
- Hunt ads carry no marker, so every ad is worth watching
- Players can own shops and get mock ad spots, 1–2 per stream, bought with Jort Coin or won

## Still open (from the design)

- [ ] Race list and each race's stat bonuses and penalties
- [ ] Starting stat numbers per job (minimums for each occupation)
- [ ] Exact Jort Coin wages, prices and skill costs
- [ ] Number of crowns at launch (2–4) and their starting lands

# Part 2: building it on MadeByJimBob (2026-10-18)

Jortlandia runs inside the site and apps that exist today: the same accounts, server, database and WebSocket, so it
adds nothing to the monthly bill at beta scale. It's planned as seven releases (below). Thirteen rules need an answer
before the first one (rule 1 is decided); each open one has a recommendation that the plan assumes until Ruben or
JimBob says otherwise.

## What it builds on

| Design piece | Already on the platform | Still needed first |
| --- | --- | --- |
| Class from tier | `users.tier` (free / plus / premium), set by Stripe or by hand (ADR-013) | — |
| Watching pays | `watch_progress` (where each viewer stopped) | MBJ-601: real watch time, live vs replay, idle tabs excluded |
| Dead players in red in live chat | Merged chat; YouTube and Rumble names linked to members (MBJ-215) | — |
| Jortlandia chat | Blocks, reports, banned words, timeouts and bans (MBJ-119, MBJ-705) | Rooms that aren't tied to a video (MBJ-904) |
| Objects at a timestamp | Chat, notes and reactions all carry `offset_ms`; the strip under the player (MBJ-217, MBJ-613) | — |
| Ticker and alerts | WebSocket rooms, `notifyFor()`, phone notifications (MBJ-405) | — |
| JB's powers | Studio tabs, admin role | A Jortlandia tab (MBJ-906) |
| Mock ads | Studio's video tools (MBJ-701) | Ad tags (MBJ-909) |
| Physical prizes | Shopify 100%-off codes, planned for MBJ-611 | — |

## Rules to settle first

| # | Question | Recommendation | Why |
| --- | --- | --- | --- |
| 1 | Can Jort Coin be bought? | **Decided (Ruben, 2026-10-18):** Jort Coin is an internal coin, never bought with real money. Players use it to buy and sell items found in the game. It's earned only (wages, watching, hunts, play) and never cashed out; no coin or items for super chats or any other payment. Selling coin or items for real money outside the game is against the terms. The membership stays the only thing sold, on the website as now. | Apple and Google require their own payments for any currency sold in an app (Apple 3.1.1), and money-backed game coin brings gambling and money-transmitter rules. Keeps it apart from the real-money wallet (MBJ-111). Tier perks in the game (a lord's land, chosen stats) are web purchases used in the app, which Apple allows only if the app sells them too (3.1.3(b)): MBJ-406 must be decided before an app with the game goes to App Review. |
| 2 | Which tier is which class? | Free = peasant or illegal (random), Plus = citizen, Premium = lord, JimBob = Emperor. JimBob names the first crowns from the lords. | The diagram's "lower tier" and "high tier", with today's three tiers. |
| 3 | What happens when a membership ends? | 30 days' grace, then a lord becomes a citizen and keeps 1 lot of their choice; a citizen becomes a peasant (never an illegal) and rents. Land given up is abandoned land, open to claim. Stats and skills stay. | The design covers upgrades but not downgrades; abandoned land is already a rule. |
| 4 | Is there land for every lord? | Make all 100,000 lots, but open them by region: the launch kingdoms open with about 10,000 lots, and the next region opens when 80% of the open land is owned. | At 100 lots each, 1,000 lords would own the whole world and leave none for citizens. With a few dozen players, 100,000 lots would feel empty. |
| 5 | Does death stop watching? | Death stops the game, never the videos. The dead watch whatever their membership allows but earn nothing, and see no clues or treasure outside live streams. | Paid members pay for the library ("paid perks are kept"), and blocking free videos would cost JimBob views. The design already says the dead effectively can't hunt. |
| 6 | How does the game know about a crime, a pitch or a recruit? | Every act is a command (typed, or tapped from a menu) aimed at a player: `pitch @name rebellion`, `ask @name about forgery`. Chat never changes the game; it's roleplay. | The server can only judge what it can see. Reading intent from chat would misfire and drag mods into game disputes. |
| 7 | Is there one XP or two? | One. Jortlandia's XP replaces MBJ-602's XP and levels, MBJ-602's badges become stat-card badges, and MBJ-603's leaderboards become season rankings. MBJ-611 (a T-shirt for watch hours) stays separate. | Two XP systems would confuse members. |
| 8 | How are alt accounts stopped? | Playing needs a confirmed email. Wages and watch rewards start when the account is 7 days old. Gifts, trades and rent from accounts under 30 days old are capped, and Studio flags any account that keeps feeding one other. | Free accounts cost nothing, so alts could farm coin and items for a main account. |
| 9 | Can winners get physical prizes? | Badges, titles and avatars drawn by JimBob from the start. Physical merch only after a lawyer has read the season rules. | A contest where paying gives an edge and luck plays a part can count as an illegal lottery in some US states. |
| 10 | Where do gangs and plotters talk in private? | Private group rooms for gangs, plots and kingdom councils (3 or more members), which members can report like chat. No one-to-one messages. | The PRD rules out private messages, but secret groups are the heart of crime and rebellion. Store rules (Apple 1.2) need anything members write to be reportable. |
| 11 | What can a capstone force? | Each capstone gets a short list of exact effects and works once a season. Mind Control picks one of a few game actions; it never spends more than a set amount of coin or starts a duel. | "Force a player to act" with no limit takes the game away from the player it's used on. |
| 12 | Age rating, and the word "illegals" | Answer the stores' age-rating forms for drug references, executions and violence; expect a higher rating for the app. Consider "outlanders" for illegals (the rules stay the same). | Store reviewers and the press may read "illegals" as being about real immigrants. Ruben's call. |
| 13 | How are new players kept from being killed on day one? | Two weeks' protection for every new character: no duels, theft, interrogation or seizure against them, and they can't do those things either. A player can't challenge the same rival again for a week. | A month dead is harsh for someone who just joined, and new free members are the people the platform wants to keep and convert. |

## How it's built

ADR-015 (proposed) has the detail. In short:

- **One place:** game code in `server/src/game/`, tables named `game_*`, the screen at `/jortlandia`. The apps run the
  same build, so the game reaches the website, Android and iPhone together.
- **Commands on the server:** the screen is a prompt plus numbered menus, BBS style. Tapping a menu item sends the
  same command a player could type, so nobody has to type on a phone. The server decides every result; the browser
  only shows it.
- **Jort Coin as a ledger:** every coin moved is a row with its reason. Balances are kept, never summed per request,
  and a nightly check compares them to the ledger. Wages and watching make new coin every day, so every release
  also adds ways to spend it for good (living costs, skills, fees, rerolls), and Studio shows coin made against coin
  spent each week so prices can be tuned before inflation sets in.
- **Secrets stay on the server:** criminal level, capstones, battleship boards and buried treasure are never sent to
  a browser that isn't allowed to see them.
- **A world tick** every 5 minutes in the server process, one copy at a time: wages, renewals, deaths and jail terms
  ending, plagues, disasters, season changes. Timers are timestamps, so a late tick never loses time.
- **One event log:** everything that happens is a `game_events` row; the ticker, stat-card histories and lifetime
  records all read it.
- **Cost:** $0 a month more at beta scale. 100,000 lots is tens of MB in the existing Postgres.

## Releases

Ordered so the first release already has something to do (hunt in the streams) and something to spend on, and
land comes after, since the game exists to bring people to JimBob's streams. Game chat rooms wait for release 2:
until there's trading and crime to talk about, the video chat is enough.

| Release | Stories | What members can do |
| --- | --- | --- |
| 1 Arrive and hunt | MBJ-601, 901–903, 905–908 | Make a character, see their class and stat card, earn Jort Coin from wages and watching, find objects in old and live streams, keep and trade items, follow the ticker under every stream. JimBob gets a Jortlandia tab in Studio and places the first treasure. |
| 2 Rooms and mock ads | 904, 909 | Talk in the Tavern, Market and private group rooms; hunt from JimBob's mock ads; player shops buy ad spots |
| 3 Land | 910–912 | Open the map beside the stream, own and rent lots, build shops, taverns and homes, dig parcels for treasure |
| 4 Work and crime | 913–915 | Work jobs, earn skills, use dark skills, spread rumors, form gangs |
| 5 Death, jail and duels | 916–918 | Die, come back, go to jail, duel to the death |
| 6 Power | 919–920 | Set taxes and laws, pledge, rebel, defect, wear a crown |
| 7 The world | 921–922 | Plagues, disasters, wars and seasons |

## Still open (for building)

- [x] Ruben: rule 1, Jort Coin (decided 2026-10-18)
- [ ] Ruben: rules 2–13 above (the plan assumes the recommendations)
- [ ] JimBob: the class names, the first crowns, and whether he'll trigger events and revive players on stream
- [ ] The design's own open items (races, job minimums, numbers, crowns at launch); until then they're Studio
      settings with placeholder values, so they can change without a release
