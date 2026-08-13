import { analyzeFleetCheats } from './cheat-editor.js';

export function analyzeShipTemplates(root) {
  const fleetAnalysis = analyzeFleetCheats(root);
  const gamestates = getGamestates(root);
  if (!gamestates) throw new Error('The save does not contain a gamestates object.');

  const faction = findStateById(gamestates, 'TIFactionState', fleetAnalysis.playerFactionId);
  const designs = Array.isArray(faction?.shipDesigns) ? faction.shipDesigns : [];
  const shipsByTemplate = new Map();
  for (const ship of fleetAnalysis.ships) {
    if (!shipsByTemplate.has(ship.templateName)) shipsByTemplate.set(ship.templateName, []);
    shipsByTemplate.get(ship.templateName).push(ship);
  }

  const templates = designs
    .filter(design => design && typeof design === 'object' && design.disable !== true && design.dataName)
    .map(design => {
      const builtShips = shipsByTemplate.get(design.dataName) ?? [];
      return {
        templateName: design.dataName,
        displayName: design._displayName || design.friendlyName || design.dataName,
        hullName: design.hullName || 'Unknown hull',
        refitIteration: Number.isFinite(design.refitIteration) ? design.refitIteration : undefined,
        builtShips: builtShips.map(ship => ({ id: ship.id, name: ship.name, fleetName: ship.fleetName })),
        slots: [
          ...templateSlots(design.noseWeaponTemplateEntries, 'nose'),
          ...templateSlots(design.hullWeaponTemplateEntries, 'hull'),
        ].sort((a, b) => a.mount.localeCompare(b.mount) || a.slotIndex - b.slotIndex),
      };
    })
    .sort((a, b) => Number(b.builtShips.length > 0) - Number(a.builtShips.length > 0)
      || a.displayName.localeCompare(b.displayName)
      || a.templateName.localeCompare(b.templateName));

  const moduleNames = [...new Set(templates.flatMap(template => template.slots.map(slot => slot.moduleName)))].sort();

  return {
    ...fleetAnalysis,
    templates,
    moduleNames,
  };
}

function templateSlots(entries, mount) {
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => entry?.moduleName && Number.isInteger(Number(entry.slot)))
    .map(entry => ({
      mount,
      slotIndex: Number(entry.slot),
      moduleName: entry.moduleName,
    }));
}

function getGamestates(root) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return undefined;
  return root.gamestates ?? root.gameStates;
}

function findStateById(gamestates, suffix, id) {
  if (!Number.isInteger(id)) return undefined;
  const groupName = Object.keys(gamestates).find(name => name.endsWith(suffix));
  const group = groupName ? gamestates[groupName] : undefined;
  if (!Array.isArray(group)) return undefined;
  for (const entry of group) {
    const value = entry?.Value ?? entry?.value ?? entry;
    const candidate = referenceId(entry?.Key) ?? referenceId(entry?.key) ?? referenceId(value?.ID) ?? referenceId(value?.id);
    if (candidate === id) return value;
  }
  return undefined;
}

function referenceId(value) {
  if (Number.isInteger(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const nested = value.value ?? value.Value ?? value.id ?? value.ID;
  if (Number.isInteger(nested)) return nested;
  return nested && typeof nested === 'object' ? referenceId(nested) : undefined;
}
