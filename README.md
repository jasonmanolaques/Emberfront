# Emberfront

A fast, arcade-paced browser territory war: settle open land with gold, then make alliances or send your soldiers to raid and conquer your neighbours, while every kingdom grows its own villages, farms, mines, towers and roads.

## Running it

```sh
npm install
npm run dev        # play at http://localhost:5173 with live reload
npm test           # simulation regression test (no browser needed)
npm run build      # type-check and build a static site into dist/
```

`dist/` can be hosted anywhere that serves static files (GitHub Pages, Netlify, itch.io). It uses relative paths, so it works from a subfolder.

## How the code is organised

```
src/
  core/      constants, colour/number helpers, seeded random & noise
  sim/       the game itself: map generation, territory, buildings, people, research, war & diplomacy, bots
  render/    camera, terrain & territory pixels, building, nature & people sprites, effects, frame drawing
  ui/        HUD, log & toasts, buildings & research panels, diplomacy & war chips, mouse/touch/keyboard input
  game.ts    connects the simulation to the screen (new game, spawn, player orders)
  main.ts    boot and the main loop
tests/       scripted matches checked against recorded results
```

**The one rule: `src/sim` never touches the page.** No `document`, no canvas, no `Math.random`. The simulation:

- runs in fixed 0.1 s ticks and gets all of its randomness from the map seed, so the same seed plus the same player orders always produce the same match;
- takes player actions only as **commands** (`queueCommand`), which are applied at the start of the next tick and re-checked there;
- reports what happened through **events** (`sim/events.ts`: tile changed, building placed, capital fell, …). Rendering and UI subscribe to these; with no subscribers (a server, a test) the simulation runs the same, just without visuals.

That split is what makes online multiplayer possible later: every browser runs the same simulation and only commands go over the network.

## How it looks

The simulation works in 2 pixels per tile (where people stand). The renderer draws everything at twice that detail (`K`, `RS`, `PS` in `core/constants.ts`): 4×4 pixels per tile, 16×16 per building plot, people 4×8. The camera works in these render pixels. Drawing never changes the simulation, so the look can change freely without touching the determinism test.

- **Terrain** (`render/terrain.ts`): a warm, slightly muted palette lit from the top-left; sea with wave dashes, a foam line and wet sand; grass tufts and the odd flower. Kingdoms get a double border: their colour on the edge and a paler line inside. Roads are two-pixel tracks with worn verges.
- **Sprites** (`render/sprites.ts`, `render/nature.ts`, `render/people.ts`) are hand-placed pixel art, many drawn from text grids (`render/pixel.ts`), and outlined automatically where they meet open ground, so towns and crowds stay readable. Buildings and trees are drawn once into layers; people are made once per look and stamped each frame.
- **People** face the way they walk and step as they go. Soldiers wear a tabard and helmet crest in their kingdom's colour and raise a spear, thrust forward on the tick they strike. Each figure is outlined in a dark shade of its kingdom's colour, so mixed crowds stay apart.

## Gold and strength

Each kingdom starts with 250 gold and earns 5 a second plus 0.1 a second in tax from each housed villager (0.2 and 0.3 with taxation research; soldiers, the homeless and beggars pay none); each coin minter adds 10% to the total. Clicking unclaimed land pushes the border there with gold from the treasury (the top slider sets how much each push takes): 1 gold a tile, more on rough ground. Unspent gold comes back when a push ends. Gold never buys another kingdom's land: that takes war (below). Raiders bring home 50 gold for each loot bag.

**Strength** is what the labels and leaderboard show: 1 per tile, 50 per villager, 100 per soldier and 3 per gold (`STR_*` in `core/constants.ts`). Beggars count for nothing.

## People

The capital releases one human every 10 seconds, 5% sooner per farm (`sim/population.ts`). Each one is a villager or a soldier, and the kingdom keeps the share of soldiers its slider asks for. Soldiers need a **barracks**: without one the slider is locked. With too few soldiers, newcomers are born soldiers at the barracks, and the villagers nearest a barracks walk in, spend 3 seconds inside, and come out as soldiers; with too many, the nearest soldiers walk in and come out as villagers.

Villagers gather (see below). Soldiers never gather: they wait in front of their barracks, or guard a watchtower that calls for them, until they are sent to war. People only walk inside their own borders (armies in the field aside), go around the castle rather than over it, and die if another kingdom takes the ground they stand on, or they fall in battle (soldiers have 11 hit points, villagers 6; see below).

## Homes

Every person, villager or soldier, needs a home: a hovel holds one, a stone house two, a manor three (below). Whenever the kingdom has less room in its houses (counting ones being built) than people, a villager's next job is to build one, so a newcomer usually starts by building his own hovel before he goes to work. He picks the plot himself the way towns grow: beside other buildings and roads, outward from the edge of town, near the capital. He walks there carrying a plank, puts up a frame, works 4 seconds, and the hovel stands; new houses connect to the road network. If a house is already free (people died but their homes survived), a newcomer goes straight to work.

With more room than people for 20 seconds, the spare houses stand empty and run down, the farthest from the capital first; as people arrive again, the innermost empty houses are lived in first (`sim/population.ts`). Land caps housing: once a kingdom's plots are full, new people stay homeless until it expands.

The people who have lived in the kingdom longest get the houses, so the newest arrivals are the homeless ones, and whoever has been homeless longest moves in first when a house comes free. Homeless villagers pay no tax. A villager homeless for a minute turns **beggar**: he crawls slowly about town in rags, does no work, pays no tax and can't be recruited, until a home comes free for him and he goes back to work. Homeless soldiers stay soldiers.

## Buildings

Houses are built by villagers (above). Everything else is placed by the kingdom from the buildings panel (the hammer button, or B) and paid for from its stockpile:

| Building | Cost (wood / stone / copper) | Does |
|---|---|---|
| Farm | 5 / 2 / 0 | New humans arrive 5% sooner per farm |
| Barracks | 5 / 5 / 0 | Trains soldiers and is where they wait; needed to raise an army |
| Watchtower | 2 / 5 / 1 | At war, shoots the nearest enemy soldier in range on your land, or else the nearest enemy villager there (2 damage every 4 s). Click it to toggle **!**: it then calls 5 idle soldiers to guard it. Several calling towers share the idle soldiers out one at a time in the order they called, so 5 soldiers for 2 towers go 3 and 2 |
| Coin minter | 5 / 5 / 5 | +10% gold income |
| Plantation | 10 / 0 / 0 | 2×2 plots. Four saplings grow into trees over 30 s, then +5 wood |
| Stone quarry | 3 / 5 / 0 | 2×2 plots. A pulley hauls stone out of the pit: +3 stone every 30 s |
| Copper mine | 10 / 10 / 0 | 2×1 plots. A shaft glowing orange: +2 copper every 30 s |
| Research station | 15 / 15 / 10 | +1 research point a second (below). Click it to open the research panel |
| Builders guild | 10 / 20 / 5 | 2×1 plots. One villager becomes its builder, who improves houses (below) |

Buildings run by themselves; only the builders guild needs a worker. They are modular: a plot draws itself from its four neighbours, so fields of farms merge into one farmland with a single fence round the outside, barracks and minters next to each other become one long hall, and neighbouring watchtowers are joined by walls (`render/sprites.ts`). The production buildings cover several plots (the top-left plot holds the building, the rest point to it); if any of their plots is taken, the whole building burns. Bots build with simple priorities of their own (`sim/bots.ts`).

## Research and better homes

Each research station earns 1 research point a second, and all of them go to the one topic the kingdom is studying: **housing** or **taxation** (`sim/research.ts`). Clicking a station opens the research panel: a button per topic with its tier, and a progress bar below; the lit one is being studied, and clicking the other switches (progress on both is kept). Housing is studied first, from the moment the first station stands. Both topics start at tier 1 and go up to tier 3: 50 points for tier 2, 100 more for tier 3. A finished topic gives way to the other. What is learned is kept for good, even if every station burns.

- **Taxation** raises each villager's tax by 0.1 gold a second per tier: 0.1, 0.2, 0.3.
- **Housing** lets the builders guild rebuild houses. The hovels villagers put up are tier 1 and they keep building hovels; at tier 2 the guild can turn them into **stone houses** (room for 2, three times the blows to burn), and at tier 3 into **manors** (room for 3, six times a hovel's).

A **builders guild** takes the villager nearest it as its builder; he wears a leather cap. When housing research allows, he walks from house to house and rebuilds each one a tier for 3 wood and 3 stone, working 5 seconds with his hammer. He rebuilds the town from the castle outward, so it looks grown rather than planned: with manors allowed, the innermost 40% of houses (the edge left a little ragged) are to become manors and the rest stone houses, and the nearest house short of what it should be goes first. An improved house is as good as new. The builder runs or fights when enemies come like any villager; if he falls, another villager takes up his tools 5 seconds later. Several guilds work side by side. Bots build stations once they have found their feet, study whichever topic is behind, and build guilds once they can use them.

## Diplomacy and war

Clicking another kingdom's land opens diplomacy (`ui/diplomacy.ts`, `sim/war.ts`):

- **Alliance.** A bot agrees unless it has 3 allies already, you attacked it in the last 90 seconds, or you are less than 0.4 of its strength. Allies are named in green, on the map and the leaderboard, and open their land to each other's armies. Declaring war on an ally ends the alliance.
- **War.** A second screen picks how many soldiers go, from none to every soldier you have free: idle soldiers at the barracks first, then watchtower guards (a warning says when guards will leave their posts). Then choose:
  - **Raid**: needs a way to the target over unclaimed or allied land, so it works on kingdoms you don't border. The raiders burn buildings from the outskirts toward the centre. A raider who destroys one carries a loot bag (one each) and keeps raiding; if he gets it home it pays 50 gold. If other kingdoms close every way through, the raid turns back.
  - **Attack**: needs a shared border, and starts a **war** that lasts until peace, whatever happens to the armies. The army **occupies** the ground it marches over (hatched with "/" lines in the occupier's colour, burning what stands there), knocks down watchtowers in its way, and pushes for the capital. Ground a defending soldier stands on can't be taken. Occupied land still belongs to its kingdom, but nobody lives, gathers or builds there. Breaking the castle (400 blows) **annexes** the kingdom: its land, buildings and people become yours, and its gold and stockpile are lost.

Two kingdoms are **at war** while a war between them lasts, or a raid between them is still out; only then do soldiers fight and watchtowers shoot. **A raid has no peace**: neither side can offer it. It ends when the raiders are all dead or home. Each war has a button at the top of the screen:

- your raid: **recall** it. The raiders stop burning and head straight home, avoiding fights and striking back only at whoever is on them, but they are still the enemy until they get there: the defenders' guard and towers fight them, and the defender can send an army after them;
- a war: **offer peace**. Bots weigh an offer by how the war is going (armies, land, how long it has lasted): they refuse while they think they can win and accept when they are in trouble. At peace each side keeps the land it occupies. Bots also offer peace when losing; the button then accepts it;
- an enemy army marching on you, or raiders fleeing home with your loot: **Respond** opens a menu under the button: request peace (in a war only), or **intercept**. Intercept picks how many soldiers go out to meet that army in the field. The slider starts at as many as they send, as far as your idle soldiers go, and you can add watchtower guards beyond that. Interceptors come home once that army is beaten or gone;
- your land all taken back after an invasion: **Counter-attack** opens the war screen with every free soldier, and keeps up as new soldiers are trained. Now you are the attacker, and they can intercept you.

**Soldiers in the field** muster in a line behind a banner on their own border, then march in formation. The banner waits for stragglers and for fights to finish, but not for ever. Soldiers break off for enemies near their own place in the line (or on them), watchtowers shooting at them, and, on a raid, buildings to burn, then fall back into line. An enemy that comrades are already fighting counts as further away, so a line meets the enemy along its whole front instead of piling onto one man. Fighters keep a little room between them (`spread` in `sim/war.ts`), so a crowd spreads into ranks rather than heaping onto one spot. **Soldiers on their own kingdom's land move 15% faster**, so defenders can catch invaders burning their towns.

**At home**, when an enemy army comes within 12 tiles of the border, the idle soldiers turn out as a **home guard**: they form a line at the point it will cross, facing it, and fight it there without ever leaving their land. Once the invaders are beaten, the guard marches on to the occupied land (the part nearest the capital first) and takes it back; pockets cut off from both armies fall back on their own. When every tile is back, the kingdom is told its army is ready to counter-attack (bots then counter-attack if they can, or ask for peace). Watchtower guards stay by their towers, fighting enemies near them, first those attacking buildings or people.

**Villagers** near an enemy decide, once, at even odds: run (they flee from the danger, staying on their land) or take up arms (a pitchfork). The armed ones fall in behind the soldiers of the home guard line, and fight only whoever comes at them; with no line, they go for the nearest enemy. Beggars always run. A while after the last enemy has gone, everyone goes back to work.

**Fighting.** Soldiers have 11 hit points and villagers 6. A soldier strikes every 0.8 s, hitting 70% of the time for 1; a villager hits for 0.5. Watchtowers shoot every 4 s for 2 damage (range 16 tiles), the castle every 2 s (range 20 tiles); both shoot only at enemies standing on their own kingdom's land, soldiers before villagers, and their bolts arc visibly to the target. A fighter lunges at his enemy as he strikes; whoever is hit flashes white and staggers back. Everyone heals 0.1 a second. Wounds show: soldiers look hurt (blood, a dented helmet, torn mail) below 8 hit points and near death below 4, head sunk, leaving a short trail of blood; villagers look bloodied below 4. The fallen drop where they stood, in a spreading pool of blood, and fade after half a minute.

**The balance of power.** Under each war button, a bar shows the current battle: each side in its colour, as wide as its share of everyone who has fought in it (the armies sent, interceptors, and anyone at home pulled into the fight), with that side's dead blacked out under skulls from its end of the bar. Below it, each side's numbers: how many are still fighting, soldiers and villagers dead, and the loot its raiders are carrying. A new battle starts when an army sets out after a lull.

**Story events** (`sim/story.ts`, told in the message log by `ui/story.ts`) are moments in a kingdom's life that change what its people do. Each has a check, run every so often for every kingdom, and a cooldown. The first: **the mob**. When enemy soldiers reach the castle, or burn a crowded part of town, the villagers nearby drop everything and swarm them, whatever they would have chosen alone.

**Bots** keep few soldiers in peace (12% to 27% by temper) so they grow, arm to at least 35% when a much bigger army sits next door, and at war raise 45% to 85% depending on how outnumbered they are, changing quickly up and slowly down. Badly outnumbered, they stay home: no new campaigns, no counter-attacks, and intercepts only with a fair fight. Otherwise they go to war when they have free soldiers to spare, choosing the weakest kingdom in reach (one already beset by two armies is left alone, an old enemy is preferred), attacking a neighbour or raiding one further off. They send idle soldiers to intercept armies marching on them, rest between campaigns, bring raids home when they have bled too much or been at it long enough, and sue for peace when a war goes badly.

## Resources

`sim/resources.ts` scatters resources over the map by terrain, so every region has its own advantage. **Nothing grows back**: once an area is stripped, a kingdom has to expand to find more.

| Resource | Where | Per harvest | Harvests |
|---|---|---|---|
| Healthy tree | dense in forests; some on grassland, hills, snow | 1 wood | 1 (felled to a stump) |
| Dry, twiggy tree | savanna, desert, beaches, hills | 1 wood | 1 |
| Rock | a little everywhere; plenty on hills and snow, most on and around mountains | 1 stone | 3 |
| Copper | rare everywhere; most in deserts, some in mountains | 1 copper | 3 |

Building on a plot clears what stood there. Villagers work in a loop: pick a resource, walk to it, harvest, carry the load home above their head, store it in the capital, come back out and decide again. They lean toward whatever the kingdom has least of (counting loads already on the way), weighed against distance, and never claim a spot another villager has taken.

## The determinism test

`tests/determinism.test.ts` plays three scripted 5-minute matches on the simulation alone and compares fingerprints of the full game state (ownership, troops, buildings, roads, fires, attacks) every 20 seconds of game time against `tests/golden.json`. A pass means the game still plays exactly as it did when the file was recorded. It was first recorded from the original single-file version, and re-recorded when the map grew to 400×248 tiles, when gold replaced troops, when the ocean shrank, when war replaced buying enemy land (it now fingerprints the armies in the field too), and when wars became lasting with occupation.

If you change gameplay on purpose, the test will fail. That's expected. Re-record the golden file with:

```sh
UPDATE_GOLDEN=1 npm test
```
