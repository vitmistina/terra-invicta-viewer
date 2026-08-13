# Terra Invicta Save Viewer

A local-first browser tool that reads a Terra Invicta save and provides four complementary strategic views:

1. **Influence attribution** shows which countries generate public-opinion Influence for each faction.
2. **Faction threat** reconstructs the score used to identify the most powerful human enemy and explains which assets contribute to it.
3. **Mining prospects** ranks every site on bodies the player faction has prospected, using editable resource-yield weights.
4. **Cheat editor** stages deliberate fleet and ship corrections and downloads a separate modified save.

The default Influence view targets **The Servants** so you can identify the countries currently funding them and model how much Influence a Public Campaign strategy could remove. The Threat, Mining, and Cheat views default to the detected human player faction.

## Features

### Influence mode

- Calculates country-level supporters, annual Influence, monthly Influence, and marginal value per percentage point.
- Switches between every public-opinion faction found in the save.
- Ranks countries by current contribution, population, support, or marginal value.
- Models a fixed percentage-point support reduction across selected countries.
- Exports the current faction breakdown as CSV.

### Faction threat mode

- Ranks all active human factions by reconstructed threat score.
- Detects the player faction from `TIPlayerState` where possible.
- Shows the player's gap to the leader, or lead over the runner-up.
- Shows the ratio to the strongest rival and the corresponding self-assessment band.
- Breaks the score into control points, armies, active hab modules, ships, and completed campaign objectives.
- Audits every included nation, army, module, ship, and objective.
- Displays each faction's saved `mostPowerfulHumanEnemy` and `selfAssessement` fields for comparison with the reconstruction.
- Marks inferred and unresolved template values instead of silently presenting them as exact.
- Exports the threat leaderboard as CSV.

### Mining prospects mode

- Reconstructs the player faction's fully prospected space bodies from faction intel entries of at least `1.0`.
- Includes every `TIHabSiteState` on those bodies and converts saved daily yields to monthly yields using the game's average month length.
- Ranks sites by a transparent weighted sum of Water, Volatiles, Base Metals, Noble Metals, and Fissiles.
- Provides editable numeric weights, persisted locally in the browser.
- Includes Balanced, Equal-weight, and Rare-resource presets.
- Filters by body and site or body name.
- Hides claimed, occupied, player-owned, and pending sites by default; a **Show claimed sites** toggle adds them back for comparison.
- Shows the dominant contributors to each site's score and exports the currently visible ranking as CSV, respecting the claimed-sites toggle.

### Fleet and ship cheat mode

- Lists the detected player's existing fleets and built ships.
- Uses a selected built ship to identify its ship-design template and allows a deployed nose or hull weapon slot to be changed at the **design level**.
- Propagates that design weapon change to every existing built player ship whose `templateName` points to the edited design, keeping the template and deployed ship states consistent.
- Does not create private per-ship design clones for weapon edits.
- Offers verified replacement weapons observed on the same hull, mount type, and starting slot elsewhere in the save.
- Includes an advanced exact-template override for deliberate experiments with modules not observed in a verified compatible slot.
- Allows one mistakenly built ship to be replaced with the complete saved technical configuration of another built player ship, useful for cases such as an extra coiler instead of a PD ship.
- Preserves that corrected ship's game-state ID, display name, fleet and formation position, launch/refit dates, kills, officers, and other identity/history fields while copying the donor's technical configuration.
- Whole-ship replacement is intentionally **per individual ship**; it does not rewrite the source design or every sibling ship using that design.
- Remaps JSON reference metadata when cloning donor state so `$id` values are not duplicated.
- Stages any number of edits in memory, shows an explicit change log, and supports resetting all staged edits.
- Downloads a separate `-cheat` save instead of modifying the loaded source.
- Preserves gzip output when the input is gzip and the browser supports `CompressionStream`.
- Preserves Terra Invicta's non-finite `Infinity`, `-Infinity`, and `NaN` numeric tokens during serialization.

### Save handling

- Loads uncompressed JSON/JSON5 and gzip-compressed saves.
- Parses JSON5 safely without `eval` or third-party dependencies.
- Resolves Terra Invicta's relational `gamestates` object structure.
- Processes the save entirely in the browser. No upload, backend, analytics, or network request is used.
- Analysis modes never modify the source save. Cheat mode edits a cloned in-memory object and writes only a new downloaded file.

## Influence formula

```text
annual influence = population in millions × support fraction × 0.5
monthly influence = annual influence ÷ 12
monthly influence removed per percentage point = population in millions ÷ 2400
```

The scenario modeller is an accounting tool, not a prediction of Public Campaign mission success. It caps the assumed reduction at the faction's current support in each selected country.

## Faction threat formula

The application reconstructs the game's human-faction threat score:

```text
threat =
  Σ controlled CPs × nation.numControlPoints_unclamped
  + Σ armies × 0.5 × home-nation miltech
  + Σ active hab modules × 0.3 × module tier
  + Σ ships × 0.3 × hull structural integrity
  + 10 × completed campaign objectives
```

When `numControlPoints_unclamped` is absent, the nation CP weight falls back to:

```text
round((GDP in billions)^(1/4) / 2)
```

The self-assessment bands relative to the strongest rival are:

- at least 200%: **Way ahead**
- at least 125%: **Ahead**
- 80% to 125%: **On par**
- 50% to 80%: **Losing**
- at most 50%: **Losing big**

### Objective-intel caveat

The actual game calculation is observer-dependent for campaign objectives: a viewing faction scores the completed campaign objectives it knows the target faction has completed. The save viewer cannot yet reconstruct every observer's objective-intelligence model. It therefore uses each faction's own completed-objective state as an omniscient estimate and separately shows the game's saved `mostPowerfulHumanEnemy` field.

Ship structural integrity is resolved from saved fields where available and otherwise from a bundled human-hull catalog. Hab module tiers are resolved from saved fields first, then from a conservative template-name catalog and heuristics. Unresolved active assets are excluded and make the displayed score an explicit lower bound.

## Mining prospect score

The default **Balanced strategic** weights are:

```text
Water         1.0
Volatiles     1.0
Base metals   0.5
Noble metals  3.0
Fissiles      6.0
```

The score is:

```text
site score = Σ monthly resource yield × selected resource weight
```

These defaults are intentionally a strategic heuristic, not a claim about universal exchange value. Base metals are discounted because they are comparatively common and often appear in higher raw volumes. Water and Volatiles remain baseline operational resources. Noble Metals receive a scarcity premium, while Fissiles receive the largest premium because a small high-fissile site can be strategically valuable despite modest bulk output.

The frontend allows any non-negative weights. The Equal-weight preset removes strategic assumptions; the Rare-resource preset emphasises Noble Metals and Fissiles more aggressively.

A body is treated as prospected when the player faction's `intel` entry for its `TISpaceBodyState` is at least `1.0`. The game then exposes all hab sites on that body. Saved site yields are daily values; the viewer multiplies them by `30.436875` to display monthly output. The ranking uses base site yields and does not apply faction-specific mining bonuses, which affect all candidate sites similarly and do not belong to the geological prospect itself.

## Cheat-mode mutation model

Built `TISpaceShipState` objects persist their deployed `noseWeapons`, `hullWeapons`, `utilityModules`, ammo and other technical state separately from the faction's dynamic ship-design templates. The game also validates deployed weapon slots against the ship's design on load. For that reason, the cheat editor changes both the design and the already-built ships that use it.

For a design weapon edit it:

1. uses the selected built ship to resolve the dynamic design through its `templateName`,
2. changes the matching `noseWeaponTemplateEntries` or `hullWeaponTemplateEntries` entry on that design,
3. finds every built player ship whose `templateName` references the same design,
4. changes the corresponding deployed weapon slot on every one of those ships,
5. updates matching inline ammo/damage module copies where present, and
6. marks relevant cached ship values dirty where the save exposes those flags.

No new design is created and all existing ships of the edited template remain on the same design.

For a whole-ship correction, another already-built player ship acts as a donor blueprint. The donor's saved technical state is cloned with fresh JSON reference IDs, then the source ship's identity and fleet/history fields are restored onto that clone. The donor itself is unchanged. This operation is intentionally per-ship because its purpose is correcting one mistaken construction.

This first implementation deliberately prefers real saved donor state over synthesizing an arbitrary unbuilt ship from template names. It is designed around correcting campaign bookkeeping mistakes, not generating impossible ships from scratch.

## Run locally

The app is static, but browser modules must be served over HTTP:

```bash
uv run python -m http.server 8080
```

Then open <http://localhost:8080>.

No dependency installation is required.

The repository is configured as a `uv` project for the Python development server. The browser application itself remains dependency-free JavaScript.

## Tests

```bash
npm test
```

The test suite uses Node's built-in test runner and covers JSON5 parsing, relational region lookup, influence calculations, scenario calculations, threat component attribution, player-faction detection, active-module filtering, CP-weight fallback, self-assessment thresholds, prospecting-intel filtering, site-to-body resolution, yield conversion, occupancy classification, custom mining weights, fleet/ship discovery, template-wide weapon propagation, donor-based ship replacement, JSON reference remapping, and non-finite save serialization.

## Supported save assumptions

Groups are located by suffix rather than requiring a full namespace. The four modes currently inspect:

- `TINationState`
- `TIRegionState`
- `TIControlPoint`
- `TIFactionState`
- `TIPlayerState`
- `TIMetadataState`
- `TIArmyState`
- `TISectorState`
- `TIHabModuleState`
- `TIHabState`
- `TIHabSiteState`
- `TISpaceBodyState`
- `TISpaceFleetState`
- `TISpaceShipState`

Known field aliases are deliberately narrow and visible in diagnostics. Unknown or malformed data is reported rather than silently normalized.

## Current limitations

- Names are taken from save fields such as `displayName`, `name`, or `templateName`; localization tokens are not translated.
- Influence mode calculates the public-opinion component only. It does not reconcile organisations, councilor traits, hab modules, or Control Point Capacity penalties against total faction income.
- Threat objective scoring is an omniscient estimate rather than a complete observer-by-observer intelligence reconstruction.
- Template catalogs may lag a newly released game build. Unknown active modules or hulls are explicitly reported.
- Mining scores do not include transfer time, delta-v, solar output, construction cost, faction mining bonuses, existing hab infrastructure, or strategic access constraints. They answer the narrower question: how attractive is the known geological yield under the selected resource priorities?
- The verified weapon-swap list proves only that a module was observed on the same hull, mount type, and starting slot elsewhere in the save. It does not independently reconstruct every ship-module compatibility rule from game templates.
- Ammo-bearing design weapon edits retain the existing saved ammo quantities while retargeting matching module references. For missiles and kinetics with materially different ammo behavior, donor-based whole-ship correction remains the safer first-version path.
- Whole-ship replacement copies the donor's saved technical condition as the blueprint and does not consume resources or construction time. This is intentionally a cheat, not a simulated refit.
- Modified saves should always be tested from a backup. Save internals can change between Terra Invicta versions.
- Gzip loading relies on the browser's native `DecompressionStream` API; gzip writing uses `CompressionStream` when available and falls back to an uncompressed JSON save otherwise.
