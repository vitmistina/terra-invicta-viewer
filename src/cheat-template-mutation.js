import { analyzeShipTemplates } from './cheat-template-model.js';
import { humanizeModuleName } from './cheat-editor.js';

export function replaceTemplateWeapon(root, { templateName, mount, slotIndex, targetModuleName }) {
  if (!templateName || !['nose', 'hull'].includes(mount) || !Number.isInteger(slotIndex) || !targetModuleName?.trim()) {
    throw new Error('Template, weapon slot, and exact target module template name are required.');
  }

  const draft = structuredClone(root);
  const analysis = analyzeShipTemplates(draft);
  const template = analysis.templates.find(item => item.templateName === templateName);
  if (!template) throw new Error(`Could not resolve ship template ${templateName}.`);

  const slot = template.slots.find(item => item.mount === mount && item.slotIndex === slotIndex);
  if (!slot) throw new Error(`${template.displayName} has no ${mount} weapon template entry at slot ${slotIndex}.`);

  const target = targetModuleName.trim();
  if (slot.moduleName === target) throw new Error('The target weapon is already installed in this template slot.');

  const gamestates = getGamestates(draft);
  const faction = findStateById(gamestates, 'TIFactionState', analysis.playerFactionId);
  const designs = Array.isArray(faction?.shipDesigns) ? faction.shipDesigns : [];
  const design = designs.find(item => item?.dataName === templateName);
  if (!design) throw new Error(`Could not resolve dynamic design ${templateName}.`);

  const entriesKey = mount === 'nose' ? 'noseWeaponTemplateEntries' : 'hullWeaponTemplateEntries';
  const designSlot = (Array.isArray(design[entriesKey]) ? design[entriesKey] : []).find(entry => Number(entry?.slot) === slotIndex);
  if (!designSlot) throw new Error(`${template.displayName} has no ${mount} weapon template entry at slot ${slotIndex}.`);

  const oldModuleName = designSlot.moduleName;
  const refIndex = buildJsonReferenceIndex(draft);
  const resolvedModules = new Set();
  const affectedShipStates = [];

  for (const instance of template.builtShips) {
    const shipState = findStateById(gamestates, 'TISpaceShipState', instance.id);
    if (!shipState) throw new Error(`Could not resolve built ship ${instance.name} (${instance.id}).`);
    const list = mount === 'nose' ? shipState.noseWeapons : shipState.hullWeapons;
    const deployed = findResolvedSlot(Array.isArray(list) ? list : [], slotIndex, refIndex);
    if (!deployed) {
      throw new Error(`${instance.name} does not resolve a ${mount} weapon beginning at slot ${slotIndex}; no changes were made.`);
    }
    resolvedModules.add(deployed);
    affectedShipStates.push(shipState);
  }

  designSlot.moduleName = target;
  for (const module of resolvedModules) setModuleTemplateName(module, target);
  for (const shipState of affectedShipStates) {
    updateInlineModuleCopies(shipState, oldModuleName, target, slotIndex, refIndex);
    markShipCachesDirty(shipState);
  }

  return {
    root: draft,
    change: {
      type: 'template-weapon-swap',
      templateName,
      designName: template.displayName,
      hullName: template.hullName,
      mount,
      slotIndex,
      from: oldModuleName,
      to: target,
      affectedShipIds: template.builtShips.map(ship => ship.id),
      affectedShipNames: template.builtShips.map(ship => ship.name),
      affectedShipCount: template.builtShips.length,
      description: `${template.displayName} (${templateName}): ${mount} slot ${slotIndex} ${humanizeModuleName(oldModuleName)} -> ${humanizeModuleName(target)}; ${template.builtShips.length} built ship${template.builtShips.length === 1 ? '' : 's'} affected`,
    },
  };
}

function buildJsonReferenceIndex(root) {
  const byId = new Map();
  walk(root, node => {
    if (isRecord(node) && typeof node.$id === 'string') byId.set(node.$id, node);
  });
  return byId;
}

function resolveJsonReference(value, refIndex) {
  if (!isRecord(value)) return undefined;
  if (typeof value.$ref === 'string') return refIndex.get(value.$ref);
  return value;
}

function findResolvedSlot(values, slotIndex, refIndex) {
  for (const value of values) {
    const resolved = resolveJsonReference(value, refIndex);
    if (slotOf(resolved) === slotIndex) return resolved;
  }
  return undefined;
}

function updateInlineModuleCopies(shipState, oldName, newName, slotIndex, refIndex) {
  for (const fieldName of ['ammo', 'damagedParts', 'prevPartsBeingRepaired']) {
    const values = Array.isArray(shipState[fieldName]) ? shipState[fieldName] : [];
    for (const item of values) {
      const raw = fieldName === 'ammo' ? item?.Key ?? item?.key : fieldName === 'damagedParts' ? item?.module : item;
      const module = resolveJsonReference(raw, refIndex);
      if (!module || slotOf(module) !== slotIndex || moduleNameOf(module) !== oldName) continue;
      setModuleTemplateName(module, newName);
    }
  }
}

function setModuleTemplateName(value, newName) {
  if ('moduleTemplateName' in value) value.moduleTemplateName = newName;
  else value.moduleTemplateName = newName;
}

function moduleNameOf(value) {
  return isRecord(value) && typeof value.moduleTemplateName === 'string' ? value.moduleTemplateName : undefined;
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

function getGamestates(root) {
  return root?.gamestates ?? root?.gameStates;
}

function findStateById(gamestates, suffix, wantedId) {
  if (!gamestates || !Number.isInteger(wantedId)) return undefined;
  const groupName = Object.keys(gamestates).find(name => name.endsWith(suffix));
  const entries = groupName ? gamestates[groupName] : undefined;
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    const value = entry?.Value ?? entry?.value ?? entry;
    const id = referenceId(entry?.Key) ?? referenceId(entry?.key) ?? referenceId(value?.ID) ?? referenceId(value?.id);
    if (id === wantedId) return value;
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

function walk(value, visitor, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visitor(value);
  if (Array.isArray(value)) value.forEach(item => walk(item, visitor, seen));
  else Object.values(value).forEach(item => walk(item, visitor, seen));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
