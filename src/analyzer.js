export const ANNUAL_INFLUENCE_PER_MILLION_SUPPORTERS = 0.5;

const KNOWN_FACTIONS = new Map([
  ['submit', 'The Servants'],
  ['servants', 'The Servants'],
  ['submitcouncil', 'The Servants'],
  ['appease', 'The Protectorate'],
  ['protectorate', 'The Protectorate'],
  ['appeasecouncil', 'The Protectorate'],
  ['cooperate', 'The Academy'],
  ['academy', 'The Academy'],
  ['cooperatecouncil', 'The Academy'],
  ['exploit', 'The Initiative'],
  ['initiative', 'The Initiative'],
  ['exploitcouncil', 'The Initiative'],
  ['escape', 'Project Exodus'],
  ['exodus', 'Project Exodus'],
  ['escapecouncil', 'Project Exodus'],
  ['resist', 'The Resistance'],
  ['resistance', 'The Resistance'],
  ['resistcouncil', 'The Resistance'],
  ['destroy', 'Humanity First'],
  ['humanityfirst', 'Humanity First'],
  ['destroycouncil', 'Humanity First'],
  ['undecided', 'Undecided'],
]);

const GROUP_SUFFIX = {
  nation: 'TINationState',
  region: 'TIRegionState',
  controlPoint: 'TIControlPoint',
  faction: 'TIFactionState',
};

export function analyzeSave(root) {
  const diagnostics = [];
  const gamestates = getGamestates(root);
  if (!gamestates) {
    throw new Error('The save does not contain a gamestates object.');
  }

  const { index, groups, duplicateIds } = buildObjectIndex(gamestates);
  for (const id of duplicateIds) diagnostics.push(warning(`Duplicate object ID ${id}; later occurrence used.`));

  const nationGroup = findGroup(groups, GROUP_SUFFIX.nation);
  const regionGroup = findGroup(groups, GROUP_SUFFIX.region);
  const controlPointGroup = findGroup(groups, GROUP_SUFFIX.controlPoint);
  const factionGroup = findGroup(groups, GROUP_SUFFIX.faction);

  if (!nationGroup) throw new Error(`Could not find a group ending in ${GROUP_SUFFIX.nation}.`);
  if (!regionGroup) diagnostics.push(warning(`Could not find a group ending in ${GROUP_SUFFIX.region}; nation-level population fallbacks will be used.`));

  const nations = groups.get(nationGroup) ?? [];
  const regions = regionGroup ? groups.get(regionGroup) ?? [] : [];
  const controlPoints = controlPointGroup ? groups.get(controlPointGroup) ?? [] : [];
  const factions = factionGroup ? groups.get(factionGroup) ?? [] : [];

  const regionById = new Map(regions.map(item => [item.id, item]));
  const regionsByNation = buildRegionsByNation(regions);
  const controlPointById = new Map(controlPoints.map(item => [item.id, item]));
  const factionNames = buildFactionNames(factions);

  const nationResults = [];
  const factionKeys = new Set();

  for (const nation of nations) {
    if (!isActiveState(nation.value)) {
      diagnostics.push(info(`Skipped archived or non-existent nation ${displayName(nation.value, nation.id)}.`, nation.id));
      continue;
    }

    const opinion = extractPublicOpinion(nation.value);
    if (!opinion) {
      diagnostics.push(warning(`Nation ${displayName(nation.value, nation.id)} has no readable publicOpinion object.`, nation.id));
      continue;
    }

    const population = resolveNationPopulation({
      nation,
      regionsByNation,
      regionById,
      diagnostics,
    });

    if (!Number.isFinite(population) || population < 0) {
      diagnostics.push(error(`Nation ${displayName(nation.value, nation.id)} has invalid population ${String(population)}.`, nation.id));
      continue;
    }

    const opinionEntries = Object.entries(opinion)
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => ({ key, support: value }));

    const finiteOpinionEntries = opinionEntries.filter(entry => Number.isFinite(entry.support));
    const opinionTotal = finiteOpinionEntries.reduce((sum, entry) => sum + entry.support, 0);
    if (Math.abs(opinionTotal - 1) > 0.00001) {
      diagnostics.push(warning(`Public opinion for ${displayName(nation.value, nation.id)} sums to ${opinionTotal.toFixed(8)}, not 1.`, nation.id));
    }

    for (const entry of opinionEntries) {
      factionKeys.add(entry.key);
      if (!Number.isFinite(entry.support) || entry.support < 0) {
        diagnostics.push(error(`Invalid ${entry.key} support in ${displayName(nation.value, nation.id)}: ${String(entry.support)}.`, nation.id));
      }
    }

    const government = firstNumber(nation.value, ['government', 'governmentScore', 'democracy']);
    const cohesion = firstNumber(nation.value, ['cohesion']);
    const unrest = firstNumber(nation.value, ['unrest']);
    const controlPointOwners = resolveControlPointOwners(nation.value, controlPointById, factionNames, index);

    nationResults.push({
      id: nation.id,
      name: displayName(nation.value, nation.id),
      populationMillions: population,
      publicOpinion: Object.fromEntries(opinionEntries.map(entry => [entry.key, entry.support])),
      government,
      cohesion,
      unrest,
      controlPointOwners,
      opinionTotal,
    });
  }

  const factionCatalog = [...factionKeys]
    .map(key => ({ key, name: factionName(key), isUndecided: normalize(key) === 'undecided' }))
    .sort((a, b) => factionSortOrder(a) - factionSortOrder(b) || a.name.localeCompare(b.name));

  const rows = [];
  for (const nation of nationResults) {
    for (const faction of factionCatalog) {
      const supportFraction = nation.publicOpinion[faction.key] ?? 0;
      rows.push(calculateNationFactionRow(nation, faction, supportFraction));
    }
  }

  const factionSummaries = factionCatalog.map(faction => {
    const factionRows = rows.filter(row => row.factionKey === faction.key);
    return {
      factionKey: faction.key,
      factionName: faction.name,
      supportersMillions: factionRows.reduce((sum, row) => sum + row.supportersMillions, 0),
      annualInfluence: factionRows.reduce((sum, row) => sum + row.annualInfluence, 0),
      monthlyInfluence: factionRows.reduce((sum, row) => sum + row.monthlyInfluence, 0),
      leadingNationCount: nationResults.filter(nation => leadingFactionKey(nation.publicOpinion) === faction.key).length,
    };
  });

  diagnostics.unshift(info(`Indexed ${index.size} objects across ${groups.size} groups.`));
  diagnostics.unshift(info(`Analyzed ${nationResults.length} nations and ${regions.length} regions.`));

  return {
    schema: {
      nationGroup,
      regionGroup,
      controlPointGroup,
      factionGroup,
      objectCount: index.size,
      groupCount: groups.size,
    },
    factions: factionCatalog,
    nations: nationResults,
    rows,
    factionSummaries,
    diagnostics,
  };
}

export function calculateNationFactionRow(nation, faction, supportFraction) {
  const supportersMillions = nation.populationMillions * supportFraction;
  const annualInfluence = supportersMillions * ANNUAL_INFLUENCE_PER_MILLION_SUPPORTERS;
  const monthlyInfluence = annualInfluence / 12;

  return {
    nationId: nation.id,
    nationName: nation.name,
    populationMillions: nation.populationMillions,
    factionKey: faction.key,
    factionName: faction.name,
    supportFraction,
    supportPercent: supportFraction * 100,
    supportersMillions,
    annualInfluence,
    monthlyInfluence,
    monthlyInfluencePerPercentagePoint: nation.populationMillions / 2400,
    government: nation.government,
    cohesion: nation.cohesion,
    unrest: nation.unrest,
    controlPointOwners: nation.controlPointOwners,
  };
}

export function calculateScenarioReduction(row, percentagePoints) {
  const requestedFraction = Math.max(0, percentagePoints) / 100;
  const removedFraction = Math.min(row.supportFraction, requestedFraction);
  return row.populationMillions * removedFraction * ANNUAL_INFLUENCE_PER_MILLION_SUPPORTERS / 12;
}

export function findServantsFactionKey(factions) {
  return factions.find(faction => faction.name === 'The Servants')?.key ?? factions.find(faction => !faction.isUndecided)?.key ?? factions[0]?.key;
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

function buildRegionsByNation(regions) {
  const result = new Map();
  for (const region of regions) {
    const nationId = firstReference(region.value, ['nation', 'nationState', 'ownerNation']);
    if (!Number.isInteger(nationId)) continue;
    if (!result.has(nationId)) result.set(nationId, []);
    result.get(nationId).push(region);
  }
  return result;
}

function resolveNationPopulation({ nation, regionsByNation, regionById, diagnostics }) {
  const referencedIds = firstReferenceArray(nation.value, ['regions', 'regionStates', 'ownedRegions']);
  const referencedRegions = referencedIds.map(id => regionById.get(id)).filter(Boolean);
  const backlinkRegions = regionsByNation.get(nation.id) ?? [];
  const allRegions = uniqueById([...referencedRegions, ...backlinkRegions]).filter(region => isActiveState(region.value));

  if (referencedIds.length && referencedRegions.length !== referencedIds.length) {
    diagnostics.push(warning(`${displayName(nation.value, nation.id)} references ${referencedIds.length - referencedRegions.length} missing region object(s).`, nation.id));
  }

  if (referencedRegions.length && backlinkRegions.length) {
    const referencedSet = new Set(referencedRegions.map(region => region.id));
    const backlinkSet = new Set(backlinkRegions.map(region => region.id));
    if (!setsEqual(referencedSet, backlinkSet)) {
      diagnostics.push(warning(`Region references and region backlinks differ for ${displayName(nation.value, nation.id)}; the union was used.`, nation.id));
    }
  }

  const regionPopulations = allRegions
    .map(region => firstNumber(region.value, ['populationInMillions', 'populationMillions', 'population']))
    .filter(value => typeof value === 'number' && Number.isFinite(value));

  if (regionPopulations.length) return regionPopulations.reduce((sum, value) => sum + value, 0);

  const direct = firstNumber(nation.value, ['populationInMillions', 'populationMillions', 'population']);
  if (typeof direct === 'number') {
    diagnostics.push(info(`Used nation-level population fallback for ${displayName(nation.value, nation.id)}.`, nation.id));
    return direct;
  }

  diagnostics.push(error(`No population could be resolved for ${displayName(nation.value, nation.id)}.`, nation.id));
  return NaN;
}

function extractPublicOpinion(value) {
  const key = findOwnKey(value, ['publicOpinion', 'public_opinion']);
  if (!key) return undefined;
  const raw = value[key];

  if (isRecord(raw)) {
    const entries = Object.entries(raw)
      .filter(([entryKey]) => !entryKey.startsWith('$'))
      .map(([entryKey, entryValue]) => [entryKey, numericValue(entryValue)])
      .filter(([, entryValue]) => typeof entryValue === 'number');
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  if (Array.isArray(raw)) {
    const entries = raw.map(item => {
      if (!isRecord(item)) return undefined;
      const entryKey = stringValue(item.Key ?? item.key);
      const entryValue = numericValue(item.Value ?? item.value);
      return entryKey && typeof entryValue === 'number' ? [entryKey, entryValue] : undefined;
    }).filter(Boolean);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  return undefined;
}

function buildFactionNames(factions) {
  return new Map(factions.map(faction => [faction.id, displayName(faction.value, faction.id)]));
}

function resolveControlPointOwners(nationValue, controlPointById, factionNames, index) {
  const refs = firstReferenceArray(nationValue, ['controlPoints', 'controlpoints']);
  const owners = [];

  for (const ref of refs) {
    const cp = controlPointById.get(ref) ?? index.get(ref);
    if (!cp) continue;
    const factionId = firstReference(cp.value, ['faction', 'ownerFaction', 'owner']);
    if (!Number.isInteger(factionId)) {
      owners.push('Uncontrolled');
      continue;
    }
    const indexedFaction = index.get(factionId);
    const inferredName = indexedFaction ? displayName(indexedFaction.value, factionId) : undefined;
    owners.push(factionNames.get(factionId) ?? inferredName ?? `Faction ${factionId}`);
  }

  return owners;
}

function leadingFactionKey(publicOpinion) {
  return Object.entries(publicOpinion)
    .filter(([key, value]) => normalize(key) !== 'undecided' && Number.isFinite(value))
    .sort((a, b) => b[1] - a[1])[0]?.[0];
}

function factionName(key) {
  return KNOWN_FACTIONS.get(normalize(key)) ?? humanize(key);
}

function factionSortOrder(faction) {
  const order = ['The Servants', 'The Protectorate', 'The Academy', 'The Initiative', 'Project Exodus', 'The Resistance', 'Humanity First', 'Undecided'];
  const index = order.indexOf(faction.name);
  return index === -1 ? 100 : index;
}

function displayName(value, id) {
  return firstString(value, ['displayName', 'name', 'templateName', 'nationName', 'abbreviation']) ?? `Object ${id}`;
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
  if (!key) return [];
  const raw = value[key];
  if (!Array.isArray(raw)) return [];
  return raw.map(referenceId).filter(Number.isInteger);
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

function uniqueById(items) {
  return [...new Map(items.map(item => [item.id, item])).values()];
}

function setsEqual(a, b) {
  return a.size === b.size && [...a].every(value => b.has(value));
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function humanize(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, char => char.toUpperCase());
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

function info(message, objectId) {
  return diagnostic('info', message, objectId);
}

function warning(message, objectId) {
  return diagnostic('warning', message, objectId);
}

function error(message, objectId) {
  return diagnostic('error', message, objectId);
}
