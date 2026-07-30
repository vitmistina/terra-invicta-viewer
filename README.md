# Terra Invicta Save Viewer

A local-first browser tool that reads a Terra Invicta save and provides two complementary strategic views:

1. **Influence attribution** shows which countries generate public-opinion Influence for each faction.
2. **Faction threat** reconstructs the score used to identify the most powerful human enemy and explains which assets contribute to it.

The default Influence view targets **The Servants** so you can identify the countries currently funding them and model how much Influence a Public Campaign strategy could remove. The Threat view defaults to the detected human player faction.

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

### Save handling

- Loads uncompressed JSON/JSON5 and gzip-compressed saves.
- Parses JSON5 safely without `eval` or third-party dependencies.
- Resolves Terra Invicta's relational `gamestates` object structure.
- Processes the save entirely in the browser. No upload, backend, analytics, or network request is used.
- Never modifies the source save.

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

## Run locally

The app is static, but browser modules must be served over HTTP:

```bash
npm run serve
```

Then open <http://localhost:8080>.

No dependency installation is required.

## Tests

```bash
npm test
```

The test suite uses Node's built-in test runner and covers JSON5 parsing, relational region lookup, influence calculations, scenario calculations, threat component attribution, player-faction detection, active-module filtering, CP-weight fallback, and self-assessment thresholds.

## Supported save assumptions

Groups are located by suffix rather than requiring a full namespace. The two modes currently inspect:

- `TINationState`
- `TIRegionState`
- `TIControlPoint`
- `TIFactionState`
- `TIPlayerState`
- `TIArmyState`
- `TISectorState`
- `TIHabModuleState`
- `TISpaceFleetState`
- `TISpaceShipState`

Known field aliases are deliberately narrow and visible in diagnostics. Unknown or malformed data is reported rather than silently normalized.

## Current limitations

- Names are taken from save fields such as `displayName`, `name`, or `templateName`; localization tokens are not translated.
- Influence mode calculates the public-opinion component only. It does not reconcile organisations, councilor traits, hab modules, or Control Point Capacity penalties against total faction income.
- Threat objective scoring is an omniscient estimate rather than a complete observer-by-observer intelligence reconstruction.
- Template catalogs may lag a newly released game build. Unknown active modules or hulls are explicitly reported.
- Gzip loading relies on the browser's native `DecompressionStream` API.
