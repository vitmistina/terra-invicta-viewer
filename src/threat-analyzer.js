export const THREAT_WEIGHTS = Object.freeze({
  controlPoint: 1,
  army: 0.5,
  habModule: 0.3,
  ship: 0.3,
  campaignObjective: 10,
});

const GROUP_SUFFIX = Object.freeze({
  faction: 'TIFactionState',
  player: 'TIPlayerState',
  nation: 'TINationState',
  region: 'TIRegionState',
  controlPoint: 'TIControlPoint',
  army: 'TIArmyState',
  sector: 'TISectorState',
  habModule: 'TIHabModuleState',
  fleet: 'TISpaceFleetState',
  ship: 'TISpaceShipState',
});

const HUMAN_FACTION_NAMES = new Map([
  ['submitcouncil', 'The Servants'],
  ['appeasecouncil', 'The Protectorate'],
  ['cooperatecouncil', 'The Academy'],
  ['exploitcouncil', 'The Initiative'],
  ['escapecouncil', 'Project Exodus'],
  ['resistcouncil', 'The Resistance'],
  ['destroycouncil', 'Humanity First'],
  ['servants', 'The Servants'],
  ['protectorate', 'The Protectorate'],
  ['academy', 'The Academy'],
  ['initiative', 'The Initiative'],
  ['exodus', 'Project Exodus'],
  ['resistance', 'The Resistance'],
  ['humanityfirst', 'Humanity First'],
]);

// Current human hull structural integrity values from the official Ship Hull List.
const HUMAN_HULL_INTEGRITY = new Map([
  ['fighter', 3],
  ['gunship', 4],
  ['escort', 7],
  ['corvette', 8],
  ['frigate', 12],
  ['monitor', 16],
  ['destroyer', 18],
  ['cruiser', 20],
  ['battlecruiser', 24],
  ['lancer', 36],
  ['battleship', 40],
  ['dreadnought', 48],
  ['titan', 64],
]);

const MODULE_TIER_EXACT = new Map(Object.entries({
  PlatformCore: 1,
  AutomatedPlatformCore: 1,
  OutpostCore: 1,
  AutomatedOutpostCore: 1,
  OrbitalCore: 2,
  SettlementCore: 2,
  RingCore: 3,
  ColonyCore: 3,
  ParticleCollider: 1,
  Atomsmasher: 2,
  Supercollider: 3,
  AntimatterTrap: 1,
  AntimatterHarvester: 2,
  AntimatterFarm: 3,
  SolarMirror: 1,
  AutomatedSolarMirror: 1,
  SolarMirrorArray: 2,
  Soletta: 3,
  DeepSpaceTelescope: 2,
  SentinelComplex: 3,
  InterstellarLaunchFacility: 3,
  SupplyDepot: 1,
  AutomatedSupplyDepot: 1,
  SpaceDock: 1,
  Shipyard: 2,
  Spaceworks: 3,
  ConstructionModule: 1,
  Nanofactory: 2,
  NanofacturingComplex: 3,
  Quarters: 1,
  ResidentialModule: 2,
  CivilianComplex: 3,
  HydroponicsBay: 1,
  Farm: 2,
  AgricultureComplex: 3,
  MarinePlatoonBarracks: 1,
  MarineCompanyBarracks: 2,
  MarineBattalionBarracks: 3,
  Skunkworks: 2,
  Foundry: 3,
  ResearchCampus: 2,
  ResearchUniversity: 3,
  OperationsCenter: 2,
  CommandCenter: 3,
  Helium3Mine: 3,
  AdministrationNode: 1,
  AdministrationTower: 2,
  AdministrationComplex: 3,
  BroadcastOutlet: 1,
  MediaCenter: 2,
  MediaComplex: 3,
}));

export function analyzeFactionThreat(root) {
  const diagnostics = [];
  const gamestates = getGamestates(root);
  if (!gamestates) throw new Error('The save does not contain a gamestates object.');

  const { index, groups, duplicateIds } = buildObjectIndex(gamestates);
  duplicateIds.forEach(id => diagnostics.push(warning(`Duplicate object ID ${id}; later occurrence used.`)));

  const groupNames = Object.fromEntries(Object.entries(GROUP_SUFFIX).map(([key, suffix]) => [key, findGroup(groups, suffix)]));
  const factions = objects(groups, groupNames.faction);
  if (!groupNames.faction || !factions.length) throw new Error('Could not find any TIFactionState objects.');

  const players = objects(groups, groupNames.player);
  const nations = objects(groups, groupNames.nation);
  const regions = objects(groups, groupNames.region);
  const controlPoints = objects(groups, groupNames.controlPoint);
  const armies = objects(groups, groupNames.army);
  const sectors = objects(groups, groupNames.sector);
  const habModules = objects(groups, groupNames.habModule);
  const fleets = objects(groups, groupNames.fleet);
  const ships = objects(groups, groupNames.ship);

  const byId = collectionsById({ nations, regions, controlPoints, armies, sectors, habModules, fleets, ships, players });
  const factionNames = new Map(factions.map(faction => [faction.id, factionDisplayName(faction)]));
  const playerFactionId = detectPlayerFactionId(factions, players, index, diagnostics);

  const humanFactions = factions.filter(faction => isActiveState(faction.value) && isHumanFaction(faction));
  if (!humanFactions.length) diagnostics.push(error('No active human factions could be identified.'));

  const results = humanFactions.map(faction => {
    const controlPointComponent = calculateControlPoints(faction, { byId, controlPoints, diagnostics });
    const armyComponent = calculateArmies(faction, { byId, armies, diagnostics });
    const habComponent = calculateHabModules(faction, { byId, habModules, sectors, diagnostics });
    const shipComponent = calculateShips(faction, { byId, fleets, ships, diagnostics });
    const objectiveComponent = calculateObjectives(faction, diagnostics);
    const components = {
      controlPoints: controlPointComponent,
      armies: armyComponent,
      habModules: habComponent,
      ships: shipComponent,
      objectives: objectiveComponent,
    };
    const total = Object.values(components).reduce((sum, component) => sum + component.score, 0);
    const unresolvedCount = Object.values(components).reduce((sum, component) => sum + (component.unresolvedCount ?? 0), 0);
    const inferredCount = Object.values(components).reduce((sum, component) => sum + (component.inferredCount ?? 0), 0);
    const savedEnemyId = firstReference(faction.value, ['mostPowerfulHumanEnemy']);

    return {
      id: faction.id,
      name: factionDisplayName(faction),
      templateName: firstString(faction.value, ['templateName']) ?? '',
      isPlayer: faction.id === playerFactionId,
      total,
      components,
      unresolvedCount,
      inferredCount,
      confidence: unresolvedCount > 0 ? 'partial' : inferredCount > 0 ? 'estimated' : 'exact',
      savedMostPowerfulEnemyId: savedEnemyId,
      savedMostPowerfulEnemyName: Number.isInteger(savedEnemyId) ? factionNames.get(savedEnemyId) ?? `Faction ${savedEnemyId}` : undefined,
      savedSelfAssessment: firstString(faction.value, ['selfAssessement', 'selfAssessment']),
    };
  });

  results.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  results.forEach((faction, indexInList) => { faction.rank = indexInList + 1; });

  const resultById = new Map(results.map(faction => [faction.id, faction]));
  for (const faction of results) {
    const strongestRival = results.filter(candidate => candidate.id !== faction.id).sort((a, b) => b.total - a.total)[0];
    faction.strongestRivalId = strongestRival?.id;
    faction.strongestRivalName = strongestRival?.name;
    faction.strongestRivalScore = strongestRival?.total ?? 0;
    faction.ratioToStrongestRival = strongestRival?.total > 0 ? faction.total / strongestRival.total : faction.total > 0 ? Infinity : 1;
    faction.assessment = selfAssessment(faction.total, strongestRival?.total ?? 0);
    faction.gapToLead = Math.max(0, (results[0]?.total ?? 0) - faction.total);
    faction.leadOverRunnerUp = faction.rank === 1 ? faction.total - (results[1]?.total ?? 0) : 0;

    if (faction.savedMostPowerfulEnemyId && resultById.has(faction.savedMostPowerfulEnemyId) && faction.savedMostPowerfulEnemyId !== faction.strongestRivalId) {
      diagnostics.push(info(`${faction.name}'s saved most powerful enemy is ${faction.savedMostPowerfulEnemyName}, while the reconstructed omniscient estimate points to ${faction.strongestRivalName}. Objective intel or unresolved template data may explain the difference.`, faction.id));
    }
  }

  const inferredAssets = results.reduce((sum, faction) => sum + faction.inferredCount, 0);
  const unresolvedAssets = results.reduce((sum, faction) => sum + faction.unresolvedCount, 0);
  diagnostics.unshift(info(`Calculated threat for ${results.length} active human factions from ${index.size} indexed objects.`));
  if (inferredAssets) diagnostics.unshift(warning(`${inferredAssets} asset value${inferredAssets === 1 ? ' was' : 's were'} inferred from template names.`));
  if (unresolvedAssets) diagnostics.unshift(error(`${unresolvedAssets} active asset${unresolvedAssets === 1 ? '' : 's'} could not be scored; displayed totals are lower bounds.`));
  diagnostics.unshift(warning('Campaign-objective threat is observer-dependent in the game. The table uses each faction’s own completed-objective save state as an omniscient estimate and also displays the game’s saved most-powerful-enemy field.'));

  return {
    factions: results,
    playerFactionId,
    schema: {
      ...groupNames,
      objectCount: index.size,
      groupCount: groups.size,
    },
    diagnostics,
  };
}

export function selfAssessment(ownScore, strongestRivalScore) {
  if (strongestRivalScore <= 0) return ownScore > 0 ? 'Way ahead' : 'On par';
  const ratio = ownScore / strongestRivalScore;
  if (ratio >= 2) return 'Way ahead';
  if (ratio >= 1.25) return 'Ahead';
  if (ratio <= 0.5) return 'Losing big';
  if (ratio <= 0.8) return 'Losing';
  return 'On par';
}

export function calculateControlPointWeight(nationValue) {
  const saved = firstNumber(nationValue, ['numControlPoints_unclamped', 'numControlPointsUnclamped']);
  if (Number.isFinite(saved)) return { value: saved, source: 'saved nation CP weight' };
  const gdpBillions = firstNumber(nationValue, ['gdpBillions', 'GDP', 'gdp']);
  if (!Number.isFinite(gdpBillions) || gdpBillions < 0) return { value: undefined, source: 'unresolved' };
  return { value: roundToEven(Math.pow(gdpBillions, 0.25) / 2), source: 'GDP formula' };
}

function calculateControlPoints(faction, context) {
  const refs = firstReferenceArray(faction.value, ['controlPoints']);
  const owned = resolveOwnedObjects(refs, context.controlPoints, context.byId.controlPoints, faction.id, ['faction', 'ownerFaction', 'owner']);
  const byNation = new Map();
  let unresolvedCount = 0;
  let inferredCount = 0;

  for (const cp of owned) {
    const nationId = firstReference(cp.value, ['nation', 'nationState']);
    const nation = context.byId.nations.get(nationId);
    if (!nation) {
      unresolvedCount += 1;
      context.diagnostics.push(error(`Control point ${cp.id} owned by ${factionDisplayName(faction)} has no resolvable nation.`, cp.id));
      continue;
    }
    const weight = calculateControlPointWeight(nation.value);
    if (!Number.isFinite(weight.value)) {
      unresolvedCount += 1;
      context.diagnostics.push(error(`Could not resolve CP threat weight for ${displayName(nation.value, nation.id)}.`, nation.id));
      continue;
    }
    if (weight.source !== 'saved nation CP weight') inferredCount += 1;
    const existing = byNation.get(nation.id) ?? {
      nationId: nation.id,
      name: displayName(nation.value, nation.id),
      controlledPoints: 0,
      weightPerPoint: weight.value,
      score: 0,
      source: weight.source,
    };
    existing.controlledPoints += 1;
    existing.score += weight.value * THREAT_WEIGHTS.controlPoint;
    byNation.set(nation.id, existing);
  }

  const items = [...byNation.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return component('Control points', items.reduce((sum, item) => sum + item.score, 0), owned.length, items, unresolvedCount, inferredCount);
}

function calculateArmies(faction, context) {
  const refs = firstReferenceArray(faction.value, ['armies']);
  const owned = resolveOwnedObjects(refs, context.armies, context.byId.armies, faction.id, ['faction']);
  const items = [];
  let unresolvedCount = 0;

  for (const army of owned) {
    if (army.value.destroyed === true || !isActiveState(army.value)) continue;
    let miltech = firstNumber(army.value, ['techLevel', 'militaryTechLevel']);
    let nation;
    if (!Number.isFinite(miltech)) {
      const regionId = firstReference(army.value, ['homeRegion', 'currentRegion']);
      const region = context.byId.regions.get(regionId);
      const nationId = region ? firstReference(region.value, ['nation', 'nationState']) : undefined;
      nation = context.byId.nations.get(nationId);
      miltech = nation ? firstNumber(nation.value, ['militaryTechLevel', 'miltech', 'maxMilitaryTechLevel']) : undefined;
    }
    if (!Number.isFinite(miltech)) {
      unresolvedCount += 1;
      context.diagnostics.push(error(`Could not resolve military tech for army ${displayName(army.value, army.id)}.`, army.id));
      continue;
    }
    items.push({
      id: army.id,
      name: displayName(army.value, army.id),
      nationName: nation ? displayName(nation.value, nation.id) : '—',
      miltech,
      score: miltech * THREAT_WEIGHTS.army,
      source: 'home nation miltech',
    });
  }

  items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return component('Armies', items.reduce((sum, item) => sum + item.score, 0), items.length, items, unresolvedCount, 0);
}

function calculateHabModules(faction, context) {
  const sectorRefs = firstReferenceArray(faction.value, ['habSectors', 'sectors']);
  const factionSectors = sectorRefs.map(id => context.byId.sectors.get(id)).filter(Boolean);
  const moduleRefs = factionSectors.flatMap(sector => firstReferenceArray(sector.value, ['habModules', 'modules']));
  let owned = uniqueById(moduleRefs.map(id => context.byId.habModules.get(id)).filter(Boolean));
  if (!owned.length) {
    const sectorSet = new Set(factionSectors.map(sector => sector.id));
    owned = context.habModules.filter(module => sectorSet.has(firstReference(module.value, ['sector'])));
  }

  const items = [];
  let unresolvedCount = 0;
  let inferredCount = 0;
  for (const module of owned) {
    if (!isActiveHabModule(module.value)) continue;
    const tier = moduleTier(module.value);
    if (!Number.isFinite(tier.value)) {
      unresolvedCount += 1;
      context.diagnostics.push(error(`Could not resolve tier for active hab module ${displayName(module.value, module.id)}.`, module.id));
      continue;
    }
    if (tier.source !== 'saved tier') inferredCount += 1;
    items.push({
      id: module.id,
      name: displayName(module.value, module.id),
      tier: tier.value,
      score: tier.value * THREAT_WEIGHTS.habModule,
      source: tier.source,
    });
  }
  items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return component('Active hab modules', items.reduce((sum, item) => sum + item.score, 0), items.length, items, unresolvedCount, inferredCount);
}

function calculateShips(faction, context) {
  const fleetRefs = firstReferenceArray(faction.value, ['fleets']);
  let factionFleets = fleetRefs.map(id => context.byId.fleets.get(id)).filter(Boolean);
  if (!factionFleets.length) factionFleets = context.fleets.filter(fleet => firstReference(fleet.value, ['faction']) === faction.id);
  const shipRefs = factionFleets.flatMap(fleet => firstReferenceArray(fleet.value, ['ships']));
  let owned = uniqueById(shipRefs.map(id => context.byId.ships.get(id)).filter(Boolean));
  if (!owned.length) {
    const fleetSet = new Set(factionFleets.map(fleet => fleet.id));
    owned = context.ships.filter(ship => fleetSet.has(firstReference(ship.value, ['fleet'])));
  }

  const designHullByName = buildShipDesignHullMap(faction.value);
  const items = [];
  let unresolvedCount = 0;
  let inferredCount = 0;
  for (const ship of owned) {
    if (!isActiveState(ship.value) || ship.value.destroyed === true) continue;
    const integrity = shipIntegrity(ship.value, designHullByName);
    if (!Number.isFinite(integrity.value)) {
      unresolvedCount += 1;
      context.diagnostics.push(error(`Could not resolve hull structural integrity for ship ${displayName(ship.value, ship.id)}.`, ship.id));
      continue;
    }
    if (integrity.source !== 'saved hull integrity') inferredCount += 1;
    items.push({
      id: ship.id,
      name: displayName(ship.value, ship.id),
      hullName: integrity.hullName ?? 'Unknown hull',
      structuralIntegrity: integrity.value,
      score: integrity.value * THREAT_WEIGHTS.ship,
      source: integrity.source,
    });
  }
  items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return component('Ships', items.reduce((sum, item) => sum + item.score, 0), items.length, items, unresolvedCount, inferredCount);
}

function calculateObjectives(faction, diagnostics) {
  const raw = firstValue(faction.value, ['objectiveNames', 'objectives']);
  const entries = dictionaryEntries(raw);
  const completed = entries.filter(([, status]) => normalizeStatus(status) === 'completed');
  const campaign = completed.filter(([name]) => !/(tutorial|victory)/i.test(name));
  if (completed.length !== campaign.length) diagnostics.push(info(`${factionDisplayName(faction)} has ${completed.length - campaign.length} completed tutorial/victory-looking objective(s) excluded from campaign threat.`, faction.id));
  const items = campaign.map(([name]) => ({ name, status: 'Completed', score: THREAT_WEIGHTS.campaignObjective, source: 'faction objective state' }));
  return component('Completed campaign objectives', items.length * THREAT_WEIGHTS.campaignObjective, items.length, items, 0, items.length ? 1 : 0);
}

function moduleTier(value) {
  const saved = firstNumber(value, ['tier', 'moduleTier']);
  if (Number.isFinite(saved)) return { value: saved, source: 'saved tier' };
  const name = firstString(value, ['templateName', 'moduleTemplateName', 'displayName', 'name']);
  if (!name) return { value: undefined, source: 'unresolved' };
  const normalized = normalize(name);
  for (const [key, tier] of MODULE_TIER_EXACT) {
    if (normalize(key) === normalized) return { value: tier, source: 'template-name catalog' };
  }
  if (/(institute|university|nanofacturingcomplex|civiliancomplex|agriculturecomplex|battlestation|spaceworks|reactorfarm|commandcenter)$/.test(normalized)) return { value: 3, source: 'template-name heuristic' };
  if (/(researchcenter|campus|nanofactory|residentialmodule|reactorarray|solararray|companybarracks|operationscenter|shipyard|orbitalcore|settlementcore)$/.test(normalized)) return { value: 2, source: 'template-name heuristic' };
  if (/(lab|pile|collector|depot|outlet|constructionmodule|quarters|bay|platoonbarracks|platformcore|outpostcore|spacedock)$/.test(normalized)) return { value: 1, source: 'template-name heuristic' };
  return { value: undefined, source: 'unresolved' };
}

function shipIntegrity(value, designHullByName) {
  const direct = firstNumberDeep(value, [
    ['hullStructuralIntegrity'],
    ['structuralIntegrity'],
    ['hull', 'structuralIntegrity'],
    ['template', 'hull', 'structuralIntegrity'],
  ]);
  if (Number.isFinite(direct)) return { value: direct, source: 'saved hull integrity', hullName: firstString(value, ['hullName']) };

  const templateName = firstString(value, ['templateName', 'shipTemplateName', 'designName']);
  const hullName = firstString(value, ['hullName']) ?? (templateName ? designHullByName.get(normalize(templateName)) : undefined) ?? inferHullName(templateName);
  const integrity = hullName ? resolveHullIntegrity(hullName) : undefined;
  return Number.isFinite(integrity)
    ? { value: integrity, source: 'official hull-name catalog', hullName }
    : { value: undefined, source: 'unresolved', hullName };
}

function buildShipDesignHullMap(factionValue) {
  const designs = firstValue(factionValue, ['shipDesigns']);
  const result = new Map();
  if (!Array.isArray(designs)) return result;
  for (const design of designs) {
    if (!isRecord(design)) continue;
    const hullName = firstString(design, ['hullName']);
    if (!hullName) continue;
    for (const key of ['dataName', 'templateName', '_displayName', 'friendlyName']) {
      const name = stringValue(design[key]);
      if (name) result.set(normalize(name), hullName);
    }
  }
  return result;
}

function resolveHullIntegrity(hullName) {
  const normalized = normalize(hullName);
  const exact = HUMAN_HULL_INTEGRITY.get(normalized);
  if (Number.isFinite(exact)) return exact;
  const match = [...HUMAN_HULL_INTEGRITY.entries()].find(([hull]) => normalized.includes(hull));
  return match?.[1];
}

function inferHullName(templateName) {
  const normalized = normalize(templateName ?? '');
  return [...HUMAN_HULL_INTEGRITY.keys()].find(hull => normalized.includes(hull));
}

function isActiveHabModule(value) {
  const hasTemplate = (firstString(value, ['templateName', 'moduleTemplateName']) ?? '').length > 0;
  return hasTemplate
    && value.constructionCompleted !== false
    && value.destroyed !== true
    && value.decommissioning !== true
    && value.powered !== false
    && isActiveState(value);
}

function component(label, score, count, items, unresolvedCount, inferredCount) {
  return { label, score, count, items, unresolvedCount, inferredCount };
}

function detectPlayerFactionId(factions, players, index, diagnostics) {
  const humanPlayer = players.find(player => player.value.isAI === false && Number.isInteger(firstReference(player.value, ['faction'])));
  if (humanPlayer) return firstReference(humanPlayer.value, ['faction']);
  for (const faction of factions) {
    const playerId = firstReference(faction.value, ['player']);
    const player = Number.isInteger(playerId) ? index.get(playerId) : undefined;
    if (player?.value?.isAI === false) return faction.id;
  }
  diagnostics.push(warning('Could not identify the player faction; the threat view will default to the highest-scoring human faction.'));
  return undefined;
}

function isHumanFaction(faction) {
  const templateName = firstString(faction.value, ['templateName']) ?? '';
  const name = factionDisplayName(faction);
  const normalizedTemplate = normalize(templateName);
  const normalizedName = normalize(name);
  if (HUMAN_FACTION_NAMES.has(normalizedTemplate) || HUMAN_FACTION_NAMES.has(normalizedName)) return true;
  return !/(alien|invader)/.test(normalizedTemplate) && !/(alien|invader)/.test(normalizedName);
}

function factionDisplayName(faction) {
  const templateName = firstString(faction.value, ['templateName']) ?? '';
  return HUMAN_FACTION_NAMES.get(normalize(templateName)) ?? displayName(faction.value, faction.id);
}

function resolveOwnedObjects(refs, all, byId, factionId, factionFields) {
  const referenced = refs.map(id => byId.get(id)).filter(Boolean);
  if (referenced.length) return uniqueById(referenced);
  return all.filter(item => firstReference(item.value, factionFields) === factionId);
}

function collectionsById(collections) {
  return Object.fromEntries(Object.entries(collections).map(([key, values]) => [key, new Map(values.map(item => [item.id, item]))]));
}

function getGamestates(root) {
  if (!isRecord(root)) return undefined;
  const key = findOwnKey(root, ['gamestates', 'gameStates']);
  return key && isRecord(root[key]) ? root[key] : undefined;
}

function buildObjectIndex(gamestates) {
  const index = new Map();
  const groups = new Map();
  const duplicateIds = [];
  for (const [groupName, entries] of Object.entries(gamestates)) {
    if (!Array.isArray(entries)) continue;
    const groupObjects = [];
    entries.forEach((entry, indexInGroup) => {
      if (!isRecord(entry)) return;
      const value = isRecord(entry.Value) ? entry.Value : isRecord(entry.value) ? entry.value : entry;
      const id = objectId(entry, value);
      if (!Number.isInteger(id)) return;
      const indexed = { id, group: groupName, indexInGroup, value };
      if (index.has(id)) duplicateIds.push(id);
      index.set(id, indexed);
      groupObjects.push(indexed);
    });
    groups.set(groupName, groupObjects);
  }
  return { index, groups, duplicateIds };
}

function objectId(entry, value) {
  return referenceId(entry.Key)
    ?? referenceId(entry.key)
    ?? referenceId(value.ID)
    ?? referenceId(value.id)
    ?? (Number.isInteger(value.ID) ? value.ID : undefined)
    ?? (Number.isInteger(value.id) ? value.id : undefined);
}

function findGroup(groups, suffix) {
  return [...groups.keys()].find(group => group.endsWith(suffix));
}

function objects(groups, groupName) {
  return groupName ? groups.get(groupName) ?? [] : [];
}

function displayName(value, id) {
  return firstString(value, ['displayName', 'name', 'personalName', 'templateName', 'nationName', 'abbreviation']) ?? `Object ${id}`;
}

function firstValue(value, candidates) {
  const key = findOwnKey(value, candidates);
  return key ? value[key] : undefined;
}

function firstString(value, candidates) {
  const raw = firstValue(value, candidates);
  return stringValue(raw);
}

function firstNumber(value, candidates) {
  const raw = firstValue(value, candidates);
  return numericValue(raw);
}

function firstNumberDeep(value, paths) {
  for (const path of paths) {
    let current = value;
    for (const key of path) {
      if (!isRecord(current)) { current = undefined; break; }
      const actual = findOwnKey(current, [key]);
      current = actual ? current[actual] : undefined;
    }
    const numeric = numericValue(current);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function firstReference(value, candidates) {
  const raw = firstValue(value, candidates);
  return referenceId(raw);
}

function firstReferenceArray(value, candidates) {
  const raw = firstValue(value, candidates);
  return Array.isArray(raw) ? raw.map(referenceId).filter(Number.isInteger) : [];
}

function findOwnKey(value, candidates) {
  if (!isRecord(value)) return undefined;
  const byNormalized = new Map(Object.keys(value).map(key => [normalize(key), key]));
  for (const candidate of candidates) {
    const match = byNormalized.get(normalize(candidate));
    if (match) return match;
  }
  return undefined;
}

function referenceId(value) {
  if (Number.isInteger(value)) return value;
  if (!isRecord(value)) return undefined;
  const raw = value.value ?? value.Value ?? value.id ?? value.ID;
  return Number.isInteger(raw) ? raw : undefined;
}

function numericValue(value) {
  if (typeof value === 'number') return value;
  if (isRecord(value) && typeof value.value === 'number') return value.value;
  return undefined;
}

function stringValue(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (isRecord(value) && typeof value.value === 'string' && value.value.trim()) return value.value.trim();
  return undefined;
}

function dictionaryEntries(value) {
  if (isRecord(value)) return Object.entries(value).filter(([key]) => !key.startsWith('$'));
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (!isRecord(item)) return undefined;
    const key = stringValue(item.Key ?? item.key);
    const entryValue = item.Value ?? item.value;
    return key ? [key, entryValue] : undefined;
  }).filter(Boolean);
}

function normalizeStatus(value) {
  if (typeof value === 'string') return normalize(value);
  if (typeof value === 'number') return value === 2 ? 'completed' : String(value);
  if (isRecord(value)) return normalizeStatus(value.value ?? value.Value ?? value.name ?? value.Name);
  return '';
}

function roundToEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function uniqueById(items) {
  return [...new Map(items.map(item => [item.id, item])).values()];
}

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isActiveState(value) {
  return value.archived !== true && value.exists !== false;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function diagnostic(level, message, objectId) {
  return { level, message, objectId };
}
function info(message, objectId) { return diagnostic('info', message, objectId); }
function warning(message, objectId) { return diagnostic('warning', message, objectId); }
function error(message, objectId) { return diagnostic('error', message, objectId); }
