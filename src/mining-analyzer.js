export const DAYS_PER_MONTH = 30.436875;

export const DEFAULT_MINING_WEIGHTS = Object.freeze({
  water: 1,
  volatiles: 1,
  metals: 0.5,
  nobleMetals: 3,
  fissiles: 6,
});

export const MINING_WEIGHT_PRESETS = Object.freeze({
  balanced: DEFAULT_MINING_WEIGHTS,
  equal: Object.freeze({ water: 1, volatiles: 1, metals: 1, nobleMetals: 1, fissiles: 1 }),
  rare: Object.freeze({ water: 0.5, volatiles: 0.5, metals: 0.25, nobleMetals: 4, fissiles: 10 }),
});

export const MINING_RESOURCES = Object.freeze([
  Object.freeze({ key: 'water', label: 'Water' }),
  Object.freeze({ key: 'volatiles', label: 'Volatiles' }),
  Object.freeze({ key: 'metals', label: 'Base metals' }),
  Object.freeze({ key: 'nobleMetals', label: 'Noble metals' }),
  Object.freeze({ key: 'fissiles', label: 'Fissiles' }),
]);

const GROUP_SUFFIX = Object.freeze({
  faction: 'TIFactionState',
  player: 'TIPlayerState',
  metadata: 'TIMetadataState',
  spaceBody: 'TISpaceBodyState',
  habSite: 'TIHabSiteState',
  hab: 'TIHabState',
});

const HUMAN_FACTION_NAMES = new Map([
  ['submitcouncil', 'The Servants'],
  ['appeasecouncil', 'The Protectorate'],
  ['cooperatecouncil', 'The Academy'],
  ['exploitcouncil', 'The Initiative'],
  ['escapecouncil', 'Project Exodus'],
  ['resistcouncil', 'The Resistance'],
  ['destroycouncil', 'Humanity First'],
]);

export function analyzeMiningProspects(root) {
  const diagnostics = [];
  const gamestates = getGamestates(root);
  if (!gamestates) throw new Error('The save does not contain a gamestates object.');

  const { index, groups, duplicateIds } = buildObjectIndex(gamestates);
  duplicateIds.forEach(id => diagnostics.push(warning(`Duplicate object ID ${id}; later occurrence used.`)));

  const groupNames = Object.fromEntries(Object.entries(GROUP_SUFFIX).map(([key, suffix]) => [key, findGroup(groups, suffix)]));
  const factions = objects(groups, groupNames.faction);
  const players = objects(groups, groupNames.player);
  const metadata = objects(groups, groupNames.metadata);
  const bodies = objects(groups, groupNames.spaceBody);
  const sites = objects(groups, groupNames.habSite);
  const habs = objects(groups, groupNames.hab);

  if (!bodies.length) throw new Error('Could not find any TISpaceBodyState objects.');
  if (!sites.length) diagnostics.push(warning('No TIHabSiteState objects were found in this save.'));

  const factionNames = new Map(factions.map(faction => [faction.id, factionDisplayName(faction)]));
  const playerFactionId = detectPlayerFactionId({ factions, players, metadata, index, diagnostics });
  const playerFaction = factions.find(faction => faction.id === playerFactionId);
  const playerFactionName = playerFaction ? factionDisplayName(playerFaction) : undefined;

  const prospectedBodyIds = playerFaction
    ? extractProspectedBodyIds(playerFaction.value, index, diagnostics)
    : new Set();

  const bodyById = new Map(bodies.map(body => [body.id, body]));
  const siteById = new Map(sites.map(site => [site.id, site]));
  const habById = new Map(habs.map(hab => [hab.id, hab]));
  const sitesByBody = buildSitesByBody(sites);
  const resultSites = [];
  const resultBodies = [];

  for (const bodyId of prospectedBodyIds) {
    const body = bodyById.get(bodyId) ?? index.get(bodyId);
    if (!body || !isGroup(body.group, GROUP_SUFFIX.spaceBody) || !isActiveState(body.value)) {
      diagnostics.push(warning(`Prospected body ${bodyId} could not be resolved as an active TISpaceBodyState.`, bodyId));
      continue;
    }

    const referencedSiteIds = firstReferenceArray(body.value, ['habSites', 'sites']);
    const referencedSites = referencedSiteIds.map(id => siteById.get(id) ?? index.get(id)).filter(Boolean);
    const backlinkSites = sitesByBody.get(body.id) ?? [];
    const bodySites = uniqueById([...referencedSites, ...backlinkSites])
      .filter(site => isGroup(site.group, GROUP_SUFFIX.habSite) && isActiveState(site.value));

    if (referencedSiteIds.length && referencedSites.length !== referencedSiteIds.length) {
      diagnostics.push(warning(`${displayName(body.value, body.id)} references ${referencedSiteIds.length - referencedSites.length} missing hab site object(s).`, body.id));
    }

    const bodyName = displayName(body.value, body.id);
    resultBodies.push({
      id: body.id,
      name: bodyName,
      siteCount: bodySites.length,
      maxHabTier: firstNumber(body.value, ['maxHabTier']),
      semiMajorAxisAU: firstNumber(body.value, ['semiMajorAxis_AU', 'semiMajorAxisAU']),
    });

    for (const site of bodySites) {
      const dailyYields = extractDailyYields(site.value, diagnostics, site.id);
      const monthlyYields = Object.fromEntries(MINING_RESOURCES.map(resource => [resource.key, dailyYields[resource.key] * DAYS_PER_MONTH]));
      const habId = firstReference(site.value, ['hab', 'base']);
      const hab = Number.isInteger(habId) ? habById.get(habId) ?? index.get(habId) : undefined;
      const ownerFactionId = hab ? firstReference(hab.value, ['faction', 'ownerFaction', 'owner']) : undefined;
      const occupancy = classifyOccupancy({
        hab,
        ownerFactionId,
        playerFactionId,
        ownerFactionName: Number.isInteger(ownerFactionId) ? factionNames.get(ownerFactionId) ?? `Faction ${ownerFactionId}` : undefined,
        pendingHab: site.value.pendingHab === true,
      });

      resultSites.push({
        id: site.id,
        name: displayName(site.value, site.id),
        templateName: firstString(site.value, ['templateName']) ?? '',
        bodyId: body.id,
        bodyName,
        dailyYields,
        monthlyYields,
        totalMonthlyYield: Object.values(monthlyYields).reduce((sum, value) => sum + value, 0),
        habId,
        ownerFactionId,
        ownerFactionName: occupancy.ownerFactionName,
        occupancyKey: occupancy.key,
        occupancyLabel: occupancy.label,
        isUnclaimed: occupancy.key === 'unclaimed',
        latitude: firstNumber(site.value, ['latitude']),
        longitude: firstNumber(site.value, ['longitude']),
        solarMultiplier: firstNumber(site.value, ['solarMultiplier']),
      });
    }
  }

  resultBodies.sort((a, b) => a.name.localeCompare(b.name));
  resultSites.sort((a, b) => a.bodyName.localeCompare(b.bodyName) || a.name.localeCompare(b.name));

  diagnostics.unshift(info(`Found ${resultSites.length} mining site${resultSites.length === 1 ? '' : 's'} across ${resultBodies.length} prospected bod${resultBodies.length === 1 ? 'y' : 'ies'}.`));
  if (playerFactionName) diagnostics.unshift(info(`Prospecting perspective: ${playerFactionName}.`));
  if (playerFaction && prospectedBodyIds.size === 0) diagnostics.unshift(warning(`${playerFactionName} has no space body with intel at or above the prospecting threshold of 1.0.`));

  return {
    playerFactionId,
    playerFactionName,
    bodies: resultBodies,
    sites: resultSites,
    defaultWeights: { ...DEFAULT_MINING_WEIGHTS },
    diagnostics,
    schema: {
      ...groupNames,
      objectCount: index.size,
      groupCount: groups.size,
      prospectedBodyCount: prospectedBodyIds.size,
    },
  };
}

export function scoreMiningSite(site, weights = DEFAULT_MINING_WEIGHTS) {
  const normalizedWeights = normalizeMiningWeights(weights);
  const contributions = Object.fromEntries(MINING_RESOURCES.map(resource => {
    const yieldValue = Number(site.monthlyYields?.[resource.key]) || 0;
    return [resource.key, yieldValue * normalizedWeights[resource.key]];
  }));
  const score = Object.values(contributions).reduce((sum, value) => sum + value, 0);
  const dominantResource = [...MINING_RESOURCES]
    .sort((a, b) => contributions[b.key] - contributions[a.key])[0];
  const dominantContribution = dominantResource ? contributions[dominantResource.key] : 0;

  return {
    ...site,
    score,
    weights: normalizedWeights,
    contributions,
    dominantResourceKey: dominantResource?.key,
    dominantResourceLabel: dominantResource?.label,
    dominantContribution,
    dominantShare: score > 0 ? dominantContribution / score : 0,
  };
}

export function scoreMiningSites(sites, weights = DEFAULT_MINING_WEIGHTS) {
  return sites.map(site => scoreMiningSite(site, weights));
}

export function normalizeMiningWeights(weights = {}) {
  return Object.fromEntries(MINING_RESOURCES.map(resource => {
    const value = Number(weights[resource.key]);
    return [resource.key, Number.isFinite(value) ? Math.max(0, value) : DEFAULT_MINING_WEIGHTS[resource.key]];
  }));
}

function extractProspectedBodyIds(factionValue, index, diagnostics) {
  const intelKey = findOwnKey(factionValue, ['intel']);
  if (!intelKey) {
    diagnostics.push(error('The detected player faction has no readable intel collection; prospected bodies cannot be reconstructed.'));
    return new Set();
  }

  const entries = keyValueEntries(factionValue[intelKey]);
  const result = new Set();
  for (const [targetRaw, intelRaw] of entries) {
    const targetId = referenceId(targetRaw);
    const intelValue = numericValue(intelRaw);
    if (!Number.isInteger(targetId) || !Number.isFinite(intelValue) || intelValue < 1) continue;
    const target = index.get(targetId);
    if (target && isGroup(target.group, GROUP_SUFFIX.spaceBody)) result.add(targetId);
  }
  return result;
}

function extractDailyYields(value, diagnostics, objectId) {
  const candidates = {
    water: ['water_day', 'waterDay'],
    volatiles: ['volatiles_day', 'volatilesDay'],
    metals: ['metals_day', 'metalsDay'],
    nobleMetals: ['nobles_day', 'nobleMetals_day', 'nobleMetalsDay'],
    fissiles: ['fissiles_day', 'fissilesDay'],
  };
  const yields = {};
  for (const resource of MINING_RESOURCES) {
    const raw = firstNumber(value, candidates[resource.key]);
    if (raw === undefined) {
      diagnostics.push(warning(`${displayName(value, objectId)} has no ${resource.label} yield field; zero was used.`, objectId));
      yields[resource.key] = 0;
    } else if (!Number.isFinite(raw) || raw < 0) {
      diagnostics.push(error(`${displayName(value, objectId)} has invalid ${resource.label} daily yield ${String(raw)}; zero was used.`, objectId));
      yields[resource.key] = 0;
    } else {
      yields[resource.key] = raw;
    }
  }
  return yields;
}

function classifyOccupancy({ hab, ownerFactionId, playerFactionId, ownerFactionName, pendingHab }) {
  if (hab && isActiveState(hab.value)) {
    if (Number.isInteger(ownerFactionId) && ownerFactionId === playerFactionId) {
      return { key: 'player', label: 'Your site', ownerFactionName };
    }
    if (Number.isInteger(ownerFactionId)) {
      return { key: 'other', label: `Claimed by ${ownerFactionName}`, ownerFactionName };
    }
    return { key: 'occupied', label: 'Occupied, owner unresolved', ownerFactionName: undefined };
  }
  if (pendingHab) return { key: 'pending', label: 'Base pending', ownerFactionName: undefined };
  return { key: 'unclaimed', label: 'Unclaimed', ownerFactionName: undefined };
}

function detectPlayerFactionId({ factions, players, metadata, index, diagnostics }) {
  const humanPlayer = players.find(player => isActiveState(player.value) && player.value.isAI === false);
  const directFactionId = humanPlayer ? firstReference(humanPlayer.value, ['faction']) : undefined;
  if (Number.isInteger(directFactionId)) return directFactionId;

  const humanPlayerIds = new Set(players.filter(player => isActiveState(player.value) && player.value.isAI === false).map(player => player.id));
  for (const faction of factions) {
    const playerId = firstReference(faction.value, ['player']);
    if (humanPlayerIds.has(playerId)) return faction.id;
  }

  const explicitlyActive = factions.find(faction => faction.value.isActivePlayer === true || faction.value.activePlayer === true);
  if (explicitlyActive) return explicitlyActive.id;

  const playerFactionName = metadata.map(item => firstString(item.value, ['playerFactionName'])).find(Boolean);
  if (playerFactionName) {
    const normalizedName = normalize(playerFactionName);
    const matched = factions.find(faction => [factionDisplayName(faction), firstString(faction.value, ['templateName'])]
      .filter(Boolean).some(name => normalize(name) === normalizedName));
    if (matched) return matched.id;
  }

  for (const faction of factions) {
    const playerId = firstReference(faction.value, ['player']);
    const player = index.get(playerId);
    if (player?.value?.isAI === false) return faction.id;
  }

  diagnostics.push(error('Could not identify the human player faction, so faction-specific prospecting knowledge is unavailable.'));
  return undefined;
}

function buildSitesByBody(sites) {
  const result = new Map();
  for (const site of sites) {
    const bodyId = firstReference(site.value, ['parentBody', 'spaceBody', 'body']);
    if (!Number.isInteger(bodyId)) continue;
    if (!result.has(bodyId)) result.set(bodyId, []);
    result.get(bodyId).push(site);
  }
  return result;
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

function keyValueEntries(raw) {
  if (Array.isArray(raw)) {
    return raw.filter(isRecord).map(item => [item.Key ?? item.key, item.Value ?? item.value]);
  }
  if (isRecord(raw)) return Object.entries(raw);
  return [];
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
  return [...groups.keys()].find(group => isGroup(group, suffix));
}

function isGroup(groupName, suffix) {
  return typeof groupName === 'string' && groupName.endsWith(suffix);
}

function objects(groups, groupName) {
  return groupName ? groups.get(groupName) ?? [] : [];
}

function factionDisplayName(faction) {
  const templateName = firstString(faction.value, ['templateName']) ?? '';
  return HUMAN_FACTION_NAMES.get(normalize(templateName)) ?? displayName(faction.value, faction.id);
}

function displayName(value, id) {
  return firstString(value, ['displayName', 'name', 'templateName', 'friendlyName', 'abbreviation']) ?? `Object ${id}`;
}

function firstString(value, candidates) {
  const key = findOwnKey(value, candidates);
  return key ? stringValue(value[key]) : undefined;
}

function firstNumber(value, candidates) {
  const key = findOwnKey(value, candidates);
  return key ? numericValue(value[key]) : undefined;
}

function firstReference(value, candidates) {
  const key = findOwnKey(value, candidates);
  return key ? referenceId(value[key]) : undefined;
}

function firstReferenceArray(value, candidates) {
  const key = findOwnKey(value, candidates);
  if (!key || !Array.isArray(value[key])) return [];
  return value[key].map(referenceId).filter(Number.isInteger);
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
  if (Number.isInteger(raw)) return raw;
  return isRecord(raw) ? referenceId(raw) : undefined;
}

function numericValue(value) {
  if (typeof value === 'number') return value;
  if (!isRecord(value)) return undefined;
  const raw = value.value ?? value.Value;
  return typeof raw === 'number' ? raw : undefined;
}

function stringValue(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return undefined;
  const raw = value.value ?? value.Value;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function uniqueById(items) {
  return [...new Map(items.map(item => [item.id, item])).values()];
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isActiveState(value) {
  return value.archived !== true && value.exists !== false && value.deleted !== true;
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
