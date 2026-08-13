import {
  analyzeFleetCheats,
  compatibleWeaponTargets,
  humanizeModuleName,
} from './cheat-editor.js';

if (typeof document !== 'undefined') {
  queueMicrotask(() => {
    const warning = document.querySelector('#cheat-mode .cheat-warning p');
    if (warning) warning.textContent = 'Every edit happens on an in-memory copy. Download creates a separate modified save. Weapon edits change the selected design template and propagate the matching deployed slot to every built ship using that design.';
    const cards = [...document.querySelectorAll('#cheat-mode .cheat-card')];
    const weaponCard = cards[0];
    const heading = weaponCard?.querySelector('h3');
    const paragraph = weaponCard?.querySelector('p');
    const button = document.querySelector('#cheat-apply-weapon');
    if (heading) heading.textContent = 'Edit a design weapon';
    if (paragraph) paragraph.textContent = 'Use this for changes such as Phaser PD to Ion PD across an existing ship class. Select any built ship of the design; the editor changes the design template and propagates that weapon slot to every built ship using it.';
    if (button) button.textContent = 'Replace weapon on design and built ships';
  });
}

export function replaceDesignWeapon(root, { shipId, mount, slotIndex, targetModuleName, allowUnobserved = false }) {
  if (!['nose', 'hull'].includes(mount)) throw new Error(`Unsupported weapon mount ${mount}.`);
  if (!Number.isInteger(shipId) || !Number.isInteger(slotIndex) || !targetModuleName) {
    throw new Error('Ship, slot, and target weapon are required.');
  }

  const draft = structuredClone(root);
  const analysis = analyzeFleetCheats(draft);
  const selectedShip = analysis.ships.find(ship => ship.id === shipId);
  if (!selectedShip) throw new Error(`Ship ${shipId} is not a built ship belonging to the detected player faction.`);
  if (!selectedShip.templateName) throw new Error(`${selectedShip.name} has no resolvable ship design template.`);

  const candidates = compatibleWeaponTargets(analysis, shipId, mount, slotIndex);
  if (!allowUnobserved && !candidates.some(candidate => candidate.moduleName === targetModuleName)) {
    throw new Error('Target weapon was not observed in the same hull, mount type, and slot in this save. Use an observed compatible target.');
  }

  const gamestates = getGamestates(draft);
  if (!gamestates) throw new Error('The save does not contain a gamestates object.');
  const groups = indexGroups(gamestates);
  const faction = findStateById(groups, 'TIFactionState', analysis.playerFactionId);
  if (!faction) throw new Error('Could not resolve the player faction state.');

  const designs = Array.isArray(faction.value.shipDesigns) ? faction.value.shipDesigns : [];
  const design = designs.find(item => item?.dataName === selectedShip.templateName);
  if (!design) throw new Error(`Could not resolve design ${selectedShip.templateName} for ${selectedShip.name}.`);

  const entriesKey = mount === 'nose' ? 'noseWeaponTemplateEntries' : 'hullWeaponTemplateEntries';
  const entries = Array.isArray(design[entriesKey]) ? design[entriesKey] : [];
  const designSlot = entries.find(entry => Number(entry?.slot) === slotIndex);
  if (!designSlot) throw new Error(`Design ${selectedShip.designName} has no ${mount} weapon template entry at slot ${slotIndex}.`);

  const oldDesignModuleName = designSlot.moduleName;
  if (!oldDesignModuleName) throw new Error('The selected design slot has no moduleName.');
  if (oldDesignModuleName === targetModuleName) throw new Error('The target weapon is already installed in this design slot.');

  const affectedSummaries = analysis.ships.filter(ship => ship.templateName === selectedShip.templateName);
  if (!affectedSummaries.length) throw new Error(`No built ships use design ${selectedShip.designName}.`);

  const shipStates = affectedSummaries.map(summary => {
    const state = findStateById(groups, 'TISpaceShipState', summary.id);
    if (!state) throw new Error(`Could not resolve built ship ${summary.name} (${summary.id}).`);
    const listKey = mount === 'nose' ? findOwnKey(state.value, ['noseWeapons']) : findOwnKey(state.value, ['hullWeapons']);
    const list = listKey && Array.isArray(state.value[listKey]) ? state.value[listKey] : [];
    const deployedSlot = list.find(item => slotOf(item) === slotIndex);
    if (!deployedSlot) throw new Error(`${summary.name} has no ${mount} weapon beginning at slot ${slotIndex}; no changes were made.`);
    return { summary, state, deployedSlot };
  });

  designSlot.moduleName = targetModuleName;

  for (const { state, deployedSlot } of shipStates) {
    const oldDeployedModuleName = moduleNameOf(deployedSlot) ?? oldDesignModuleName;
    setModuleTemplateName(deployedSlot, targetModuleName);
    updateInlineModuleCopies(state.value, oldDeployedModuleName, targetModuleName, slotIndex);
    markShipCachesDirty(state.value);
  }

  const affectedShipIds = affectedSummaries.map(ship => ship.id);
  const affectedShipNames = affectedSummaries.map(ship => ship.name);
  return {
    root: draft,
    change: {
      type: 'design-weapon-swap',
      designTemplateName: selectedShip.templateName,
      designName: selectedShip.designName,
      mount,
      slotIndex,
      from: oldDesignModuleName,
      to: targetModuleName,
      affectedShipIds,
      affectedShipNames,
      affectedShipCount: affectedShipIds.length,
      description: `${selectedShip.designName}: ${mount} slot ${slotIndex} ${humanizeModuleName(oldDesignModuleName)} -> ${humanizeModuleName(targetModuleName)}; propagated to ${affectedShipIds.length} built ship${affectedShipIds.length === 1 ? '' : 's'}`,
    },
  };
}

function getGamestates(root) {
  if (!isRecord(root)) return undefined;
  const key = findOwnKey(root, ['gamestates', 'gameStates']);
  return key && isRecord(root[key]) ? root[key] : undefined;
}

function indexGroups(gamestates) {
  return Object.entries(gamestates)
    .filter(([, entries]) => Array.isArray(entries))
    .map(([name, entries]) => ({ name, entries }));
}

function findStateById(groups, suffix, wantedId) {
  const group = groups.find(item => item.name.endsWith(suffix));
  if (!group) return undefined;
  for (const entry of group.entries) {
    if (!isRecord(entry)) continue;
    const value = isRecord(entry.Value) ? entry.Value : isRecord(entry.value) ? entry.value : entry;
    const id = referenceId(entry.Key) ?? referenceId(entry.key) ?? referenceId(value.ID) ?? referenceId(value.id);
    if (id === wantedId) return { entry, value };
  }
  return undefined;
}

function updateInlineModuleCopies(shipValue, oldName, newName, slotIndex) {
  for (const fieldName of ['ammo', 'damagedParts', 'prevPartsBeingRepaired']) {
    const fieldKey = findOwnKey(shipValue, [fieldName]);
    const values = fieldKey && Array.isArray(shipValue[fieldKey]) ? shipValue[fieldKey] : [];
    for (const item of values) {
      const module = fieldName === 'ammo'
        ? item?.Key ?? item?.key
        : fieldName === 'damagedParts'
          ? item?.module
          : item;
      if (!isRecord(module) || module.$ref) continue;
      if (slotOf(module) !== slotIndex || moduleNameOf(module) !== oldName) continue;
      setModuleTemplateName(module, newName);
    }
  }
}

function setModuleTemplateName(value, newName) {
  const key = findOwnKey(value, ['moduleTemplateName']);
  if (key) value[key] = newName;
  else value.moduleTemplateName = newName;
}

function moduleNameOf(value) {
  const key = findOwnKey(value, ['moduleTemplateName']);
  return key && typeof value[key] === 'string' ? value[key] : undefined;
}

function slotOf(value) {
  if (!isRecord(value)) return undefined;
  const raw = value.slotIndex ?? value.slot ?? value.SlotIndex;
  return Number.isInteger(Number(raw)) ? Number(raw) : undefined;
}

function markShipCachesDirty(value) {
  if (Object.prototype.hasOwnProperty.call(value, 'propulsionValuesDataDirty')) value.propulsionValuesDataDirty = true;
  if (Object.prototype.hasOwnProperty.call(value, 'spaceCombatValueDataDirty')) value.spaceCombatValueDataDirty = true;
}

function findOwnKey(value, candidates) {
  if (!isRecord(value)) return undefined;
  const keys = new Map(Object.keys(value).map(key => [normalize(key), key]));
  for (const candidate of candidates) {
    const match = keys.get(normalize(candidate));
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

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
