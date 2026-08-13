const GROUP_SUFFIX = Object.freeze({
  faction: 'TIFactionState',
  player: 'TIPlayerState',
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
]);

const SHIP_IDENTITY_FIELDS = Object.freeze([
  'ID',
  'displayName',
  'fleet',
  'fleetFormationOffset',
  'launchDate',
  'lastRefitDate',
  'homeRegion',
  'kills',
  'officers',
  'finderSortOverride',
  'exists',
  'archived',
  'gameStateSubjectCreated',
]);

export function analyzeFleetCheats(root) {
  const context = buildContext(root);
  const diagnostics = [...context.diagnostics];
  const playerFaction = context.playerFaction;
  if (!playerFaction) {
    return {
      playerFactionId: undefined,
      playerFactionName: undefined,
      fleets: [],
      ships: [],
      weaponCatalog: [],
      diagnostics,
    };
  }

  const playerFactionName = factionDisplayName(playerFaction);
  const playerFleetIds = new Set(firstReferenceArray(playerFaction.value, ['fleets']));
  const playerFleets = context.fleets.filter(fleet => playerFleetIds.has(fleet.id) && isActiveState(fleet.value));
  const fleetById = new Map(playerFleets.map(fleet => [fleet.id, fleet]));
  const playerShipIds = new Set(playerFleets.flatMap(fleet => firstReferenceArray(fleet.value, ['ships'])));
  const playerShips = context.ships.filter(ship => playerShipIds.has(ship.id) && isActiveState(ship.value));
  const playerDesigns = shipDesigns(playerFaction.value);
  const designByName = new Map(playerDesigns.map(design => [design.dataName, design]));
  const weaponCatalog = buildWeaponCatalog(context.factions);

  const ships = playerShips.map(ship => {
    const templateName = firstString(ship.value, ['templateName']) ?? '';
    const design = designByName.get(templateName);
    const fleetId = firstReference(ship.value, ['fleet']);
    const fleet = fleetById.get(fleetId);
    const weapons = [
      ...weaponSlots(ship.value, 'nose'),
      ...weaponSlots(ship.value, 'hull'),
    ];
    return {
      id: ship.id,
      name: displayName(ship.value, ship.id),
      fleetId,
      fleetName: fleet ? displayName(fleet.value, fleet.id) : `Fleet ${fleetId ?? '?'}`,
      templateName,
      designName: designDisplayName(design) ?? templateName || 'Unknown design',
      hullName: design?.hullName ?? 'Unknown hull',
      weapons,
      utilityModules: moduleNames(ship.value.utilityModules),
      currentDeltaV: firstNumber(ship.value, ['currentDeltaV_kps']),
      currentMaxDeltaV: firstNumber(ship.value, ['currentMaxDeltaV_kps']),
      currentMassKg: firstNumber(ship.value, ['currentMass_kg']),
    };
  }).sort((a, b) => a.fleetName.localeCompare(b.fleetName) || a.name.localeCompare(b.name));

  const shipsByFleet = new Map();
  for (const ship of ships) {
    if (!shipsByFleet.has(ship.fleetId)) shipsByFleet.set(ship.fleetId, []);
    shipsByFleet.get(ship.fleetId).push(ship);
  }

  const fleets = playerFleets.map(fleet => ({
    id: fleet.id,
    name: displayName(fleet.value, fleet.id),
    ships: shipsByFleet.get(fleet.id) ?? [],
  })).sort((a, b) => a.name.localeCompare(b.name));

  diagnostics.unshift(info(`Cheat editor found ${ships.length} built player ship${ships.length === 1 ? '' : 's'} in ${fleets.length} fleet${fleets.length === 1 ? '' : 's'}.`));
  diagnostics.unshift(info(`Cheat perspective: ${playerFactionName}.`));

  return {
    playerFactionId: playerFaction.id,
    playerFactionName,
    fleets,
    ships,
    weaponCatalog,
    diagnostics,
  };
}

export function compatibleWeaponTargets(analysis, shipId, mount, slotIndex) {
  const ship = analysis.ships.find(item => item.id === shipId);
  if (!ship) return [];
  const current = ship.weapons.find(item => item.mount === mount && item.slotIndex === slotIndex);
  return analysis.weaponCatalog
    .filter(item => item.hullName === ship.hullName && item.mount === mount && item.slot === slotIndex && item.moduleName !== current?.moduleTemplateName)
    .filter((item, index, all) => all.findIndex(candidate => candidate.moduleName === item.moduleName) === index)
    .sort((a, b) => humanizeModuleName(a.moduleName).localeCompare(humanizeModuleName(b.moduleName)));
}

export function swapBuiltShipWeapon(root, { shipId, mount, slotIndex, targetModuleName, allowUnobserved = false }) {
  if (!['nose', 'hull'].includes(mount)) throw new Error(`Unsupported weapon mount ${mount}.`);
  if (!Number.isInteger(shipId) || !Number.isInteger(slotIndex) || !targetModuleName) throw new Error('Ship, slot, and target weapon are required.');

  const draft = structuredClone(root);
  const context = buildContext(draft);
  const analysis = analyzeFleetCheats(draft);
  const sourceSummary = analysis.ships.find(ship => ship.id === shipId);
  if (!sourceSummary) throw new Error(`Ship ${shipId} is not a built ship belonging to the detected player faction.`);

  const source = context.byId.get(shipId);
  const weaponKey = mount === 'nose' ? findOwnKey(source.value, ['noseWeapons']) : findOwnKey(source.value, ['hullWeapons']);
  const weaponList = weaponKey && Array.isArray(source.value[weaponKey]) ? source.value[weaponKey] : [];
  const slot = weaponList.find(item => referenceSlotIndex(item) === slotIndex);
  if (!slot) throw new Error(`${sourceSummary.name} has no ${mount} weapon beginning at slot ${slotIndex}.`);

  const oldModuleName = firstString(slot, ['moduleTemplateName']);
  if (!oldModuleName) throw new Error('The selected deployed weapon has no moduleTemplateName.');
  if (oldModuleName === targetModuleName) throw new Error('The target weapon is already installed in this slot.');

  const candidates = compatibleWeaponTargets(analysis, shipId, mount, slotIndex);
  if (!allowUnobserved && !candidates.some(candidate => candidate.moduleName === targetModuleName)) {
    throw new Error('Target weapon was not observed in the same hull, mount type, and slot in this save. Use an observed compatible target.');
  }

  const faction = context.playerFaction;
  const designsKey = findOwnKey(faction.value, ['shipDesigns']);
  const designs = designsKey && Array.isArray(faction.value[designsKey]) ? faction.value[designsKey] : [];
  const designIndex = designs.findIndex(design => design?.dataName === sourceSummary.templateName);
  if (designIndex < 0) throw new Error(`Could not resolve design ${sourceSummary.templateName} for ${sourceSummary.name}.`);

  const originalDesign = designs[designIndex];
  const privateDesign = cloneWithFreshReferenceIds(originalDesign, draft);
  const privateName = uniqueCheatDesignName(designs, originalDesign.dataName || sourceSummary.templateName || 'ShipDesign', shipId);
  privateDesign.dataName = privateName;
  privateDesign.refitIteration = Number.isInteger(privateDesign.refitIteration) ? privateDesign.refitIteration + 1 : 1;
  const baseFriendly = privateDesign.friendlyName || privateDesign._displayName || designDisplayName(originalDesign) || sourceSummary.designName;
  privateDesign.friendlyName = `${baseFriendly} [ship ${shipId}]`;
  privateDesign._displayName = privateDesign.friendlyName;
  privateDesign.disable = false;

  const entriesKey = mount === 'nose' ? 'noseWeaponTemplateEntries' : 'hullWeaponTemplateEntries';
  const entries = Array.isArray(privateDesign[entriesKey]) ? privateDesign[entriesKey] : [];
  const designSlot = entries.find(entry => Number(entry?.slot) === slotIndex);
  if (!designSlot) throw new Error(`Design ${sourceSummary.designName} has no ${mount} weapon template entry at slot ${slotIndex}.`);
  designSlot.moduleName = targetModuleName;

  designs.push(privateDesign);
  const countKey = findOwnKey(faction.value, ['shipDesignCount']);
  if (countKey) faction.value[countKey] = designs.length;

  const templateKey = findOwnKey(source.value, ['templateName']);
  if (!templateKey) throw new Error('Ship state has no templateName field.');
  source.value[templateKey] = privateName;
  setModuleTemplateName(slot, targetModuleName);
  updateInlineModuleCopies(source.value, oldModuleName, targetModuleName, slotIndex);
  markShipCachesDirty(source.value);

  return {
    root: draft,
    change: {
      type: 'weapon-swap',
      shipId,
      shipName: sourceSummary.name,
      mount,
      slotIndex,
      from: oldModuleName,
      to: targetModuleName,
      privateDesignName: privateName,
      description: `${sourceSummary.name}: ${mount} slot ${slotIndex} ${humanizeModuleName(oldModuleName)} -> ${humanizeModuleName(targetModuleName)}`,
    },
  };
}

export function replaceBuiltShipFromDonor(root, { sourceShipId, donorShipId }) {
  if (!Number.isInteger(sourceShipId) || !Number.isInteger(donorShipId)) throw new Error('Source and donor ships are required.');
  if (sourceShipId === donorShipId) throw new Error('Source and donor ships must be different.');

  const draft = structuredClone(root);
  const analysis = analyzeFleetCheats(draft);
  const sourceSummary = analysis.ships.find(ship => ship.id === sourceShipId);
  const donorSummary = analysis.ships.find(ship => ship.id === donorShipId);
  if (!sourceSummary || !donorSummary) throw new Error('Both source and donor must be built ships belonging to the detected player faction.');

  const context = buildContext(draft);
  const source = context.byId.get(sourceShipId);
  const donor = context.byId.get(donorShipId);
  if (!source || !donor) throw new Error('Could not resolve source or donor ship state.');

  const replacement = cloneWithFreshReferenceIds(donor.value, draft);
  for (const key of SHIP_IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source.value, key)) replacement[key] = structuredClone(source.value[key]);
  }
  const sourceIdKey = findOwnKey(source.value, ['ID', 'id']);
  if (sourceIdKey) replacement[sourceIdKey] = structuredClone(source.value[sourceIdKey]);
  const sourceNameKey = findOwnKey(source.value, ['displayName']);
  if (sourceNameKey) replacement[sourceNameKey] = source.value[sourceNameKey];
  markShipCachesDirty(replacement);

  source.setValue(replacement);

  return {
    root: draft,
    change: {
      type: 'ship-replacement',
      sourceShipId,
      sourceShipName: sourceSummary.name,
      donorShipId,
      donorShipName: donorSummary.name,
      fromDesign: sourceSummary.designName,
      toDesign: donorSummary.designName,
      description: `${sourceSummary.name}: ${sourceSummary.designName} -> donor configuration ${donorSummary.designName} (${donorSummary.name})`,
    },
  };
}

export function humanizeModuleName(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildContext(root) {
  const diagnostics = [];
  const gamestates = getGamestates(root);
  if (!gamestates) throw new Error('The save does not contain a gamestates object.');
  const { byId, groups, duplicateIds } = buildObjectIndex(gamestates);
  duplicateIds.forEach(id => diagnostics.push(warning(`Duplicate object ID ${id}; later occurrence used.`)));
  const factionGroup = findGroup(groups, GROUP_SUFFIX.faction);
  const playerGroup = findGroup(groups, GROUP_SUFFIX.player);
  const fleetGroup = findGroup(groups, GROUP_SUFFIX.fleet);
  const shipGroup = findGroup(groups, GROUP_SUFFIX.ship);
  const factions = objects(groups, factionGroup);
  const players = objects(groups, playerGroup);
  const fleets = objects(groups, fleetGroup);
  const ships = objects(groups, shipGroup);
  const playerFactionId = detectPlayerFactionId(factions, players, byId, diagnostics);
  const playerFaction = factions.find(faction => faction.id === playerFactionId);
  return { root, gamestates, byId, groups, factions, players, fleets, ships, playerFactionId, playerFaction, diagnostics };
}

function buildWeaponCatalog(factions) {
  const catalog = [];
  for (const faction of factions) {
    for (const design of shipDesigns(faction.value)) {
      const hullName = design?.hullName;
      if (!hullName) continue;
      for (const [mount, key] of [['nose', 'noseWeaponTemplateEntries'], ['hull', 'hullWeaponTemplateEntries']]) {
        for (const entry of Array.isArray(design[key]) ? design[key] : []) {
          if (!entry?.moduleName || !Number.isInteger(Number(entry.slot))) continue;
          catalog.push({
            moduleName: entry.moduleName,
            hullName,
            mount,
            slot: Number(entry.slot),
            designName: designDisplayName(design) ?? design.dataName ?? 'Unknown design',
            factionName: factionDisplayName(faction),
          });
        }
      }
    }
  }
  return catalog;
}

function shipDesigns(factionValue) {
  const key = findOwnKey(factionValue, ['shipDesigns']);
  return key && Array.isArray(factionValue[key]) ? factionValue[key].filter(item => item && typeof item === 'object') : [];
}

function weaponSlots(shipValue, mount) {
  const key = mount === 'nose' ? findOwnKey(shipValue, ['noseWeapons']) : findOwnKey(shipValue, ['hullWeapons']);
  const values = key && Array.isArray(shipValue[key]) ? shipValue[key] : [];
  return values.map(item => ({
    mount,
    slotIndex: referenceSlotIndex(item),
    moduleTemplateName: firstString(item, ['moduleTemplateName']) ?? 'Unknown weapon',
  })).filter(item => Number.isInteger(item.slotIndex));
}

function moduleNames(values) {
  if (!Array.isArray(values)) return [];
  return values.map(item => firstString(item, ['moduleTemplateName'])).filter(Boolean);
}

function designDisplayName(design) {
  if (!design || typeof design !== 'object') return undefined;
  return [design.friendlyName, design._displayName, design.dataName].find(value => typeof value === 'string' && value.trim())?.trim();
}

function uniqueCheatDesignName(designs, baseName, shipId) {
  const existing = new Set(designs.map(design => design?.dataName).filter(Boolean));
  const safeBase = String(baseName).replace(/[^A-Za-z0-9_]+/g, '_');
  let suffix = 1;
  let candidate = `${safeBase}__cheat_ship_${shipId}`;
  while (existing.has(candidate)) candidate = `${safeBase}__cheat_ship_${shipId}_${suffix++}`;
  return candidate;
}

function updateInlineModuleCopies(shipValue, oldName, newName, slotIndex) {
  const ammoKey = findOwnKey(shipValue, ['ammo']);
  if (ammoKey && Array.isArray(shipValue[ammoKey])) {
    for (const item of shipValue[ammoKey]) {
      const key = item?.Key ?? item?.key;
      if (key && !key.$ref && firstString(key, ['moduleTemplateName']) === oldName && referenceSlotIndex(key) === slotIndex) {
        setModuleTemplateName(key, newName);
      }
    }
  }
  const damagedPartsKey = findOwnKey(shipValue, ['damagedParts']);
  if (damagedPartsKey && Array.isArray(shipValue[damagedPartsKey])) {
    for (const item of shipValue[damagedPartsKey]) {
      const module = item?.module;
      if (module && !module.$ref && firstString(module, ['moduleTemplateName']) === oldName && referenceSlotIndex(module) === slotIndex) {
        setModuleTemplateName(module, newName);
      }
    }
  }
  const repairingKey = findOwnKey(shipValue, ['prevPartsBeingRepaired']);
  if (repairingKey && Array.isArray(shipValue[repairingKey])) {
    for (const module of shipValue[repairingKey]) {
      if (module && !module.$ref && firstString(module, ['moduleTemplateName']) === oldName && referenceSlotIndex(module) === slotIndex) {
        setModuleTemplateName(module, newName);
      }
    }
  }
}

function setModuleTemplateName(value, newName) {
  const key = findOwnKey(value, ['moduleTemplateName']);
  if (key) value[key] = newName;
  else value.moduleTemplateName = newName;
}

function markShipCachesDirty(value) {
  if (Object.prototype.hasOwnProperty.call(value, 'propulsionValuesDataDirty')) value.propulsionValuesDataDirty = true;
  if (Object.prototype.hasOwnProperty.call(value, 'spaceCombatValueDataDirty')) value.spaceCombatValueDataDirty = true;
}

function cloneWithFreshReferenceIds(value, root) {
  const idsInRoot = new Set();
  walk(root, node => {
    if (node && typeof node === 'object' && !Array.isArray(node) && typeof node.$id === 'string') idsInRoot.add(node.$id);
  });
  let nextId = Math.max(0, ...[...idsInRoot].map(id => /^\d+$/.test(id) ? Number(id) : 0)) + 1;
  const localIds = new Set();
  walk(value, node => {
    if (node && typeof node === 'object' && !Array.isArray(node) && typeof node.$id === 'string') localIds.add(node.$id);
  });
  const remap = new Map([...localIds].map(id => {
    while (idsInRoot.has(String(nextId))) nextId += 1;
    const fresh = String(nextId++);
    idsInRoot.add(fresh);
    return [id, fresh];
  }));
  const cloned = structuredClone(value);
  walk(cloned, node => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    if (typeof node.$id === 'string' && remap.has(node.$id)) node.$id = remap.get(node.$id);
    if (typeof node.$ref === 'string' && remap.has(node.$ref)) node.$ref = remap.get(node.$ref);
  });
  return cloned;
}

function walk(value, visitor, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visitor(value);
  if (Array.isArray(value)) {
    value.forEach(item => walk(item, visitor, seen));
  } else {
    Object.values(value).forEach(item => walk(item, visitor, seen));
  }
}

function detectPlayerFactionId(factions, players, byId, diagnostics) {
  const humanPlayers = players.filter(player => isActiveState(player.value) && player.value.isAI === false);
  for (const player of humanPlayers) {
    const directFactionId = firstReference(player.value, ['faction']);
    if (Number.isInteger(directFactionId)) return directFactionId;
  }
  const humanPlayerIds = new Set(humanPlayers.map(player => player.id));
  for (const faction of factions) {
    if (humanPlayerIds.has(firstReference(faction.value, ['player']))) return faction.id;
  }
  for (const faction of factions) {
    const player = byId.get(firstReference(faction.value, ['player']));
    if (player?.value?.isAI === false) return faction.id;
  }
  diagnostics.push(error('Could not identify the human player faction. Cheat mode is disabled.'));
  return undefined;
}

function getGamestates(root) {
  if (!isRecord(root)) return undefined;
  const key = findOwnKey(root, ['gamestates', 'gameStates']);
  return key && isRecord(root[key]) ? root[key] : undefined;
}

function buildObjectIndex(gamestates) {
  const byId = new Map();
  const groups = new Map();
  const duplicateIds = [];
  for (const [groupName, entries] of Object.entries(gamestates)) {
    if (!Array.isArray(entries)) continue;
    const groupObjects = [];
    entries.forEach((entry, indexInGroup) => {
      if (!isRecord(entry)) return;
      const valueKey = isRecord(entry.Value) ? 'Value' : isRecord(entry.value) ? 'value' : undefined;
      const value = valueKey ? entry[valueKey] : entry;
      const id = objectId(entry, value);
      if (!Number.isInteger(id)) return;
      const indexed = {
        id,
        group: groupName,
        indexInGroup,
        entry,
        value,
        setValue(next) {
          if (valueKey) entry[valueKey] = next;
          else {
            for (const key of Object.keys(entry)) delete entry[key];
            Object.assign(entry, next);
          }
          this.value = next;
        },
      };
      if (byId.has(id)) duplicateIds.push(id);
      byId.set(id, indexed);
      groupObjects.push(indexed);
    });
    groups.set(groupName, groupObjects);
  }
  return { byId, groups, duplicateIds };
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
  return [...groups.keys()].find(group => typeof group === 'string' && group.endsWith(suffix));
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
  if (!key) return undefined;
  const raw = value[key];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (isRecord(raw)) {
    const nested = raw.value ?? raw.Value;
    if (typeof nested === 'string' && nested.trim()) return nested.trim();
  }
  return undefined;
}

function firstNumber(value, candidates) {
  const key = findOwnKey(value, candidates);
  if (!key) return undefined;
  const raw = value[key];
  if (typeof raw === 'number') return raw;
  if (isRecord(raw)) {
    const nested = raw.value ?? raw.Value;
    return typeof nested === 'number' ? nested : undefined;
  }
  return undefined;
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
  const normalizedKeys = new Map(Object.keys(value).map(key => [normalize(key), key]));
  for (const candidate of candidates) {
    const match = normalizedKeys.get(normalize(candidate));
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

function referenceSlotIndex(value) {
  if (!isRecord(value)) return undefined;
  const raw = value.slotIndex ?? value.slot ?? value.SlotIndex;
  return Number.isInteger(Number(raw)) ? Number(raw) : undefined;
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

function diagnostic(level, message, objectId) { return { level, message, objectId }; }
function info(message, objectId) { return diagnostic('info', message, objectId); }
function warning(message, objectId) { return diagnostic('warning', message, objectId); }
function error(message, objectId) { return diagnostic('error', message, objectId); }
