export function findEditableRootShipIds(root) {
  const gamestates = root?.gamestates ?? root?.gameStates;
  if (!gamestates || typeof gamestates !== 'object') return new Set();

  const shipGroupName = Object.keys(gamestates).find(name => name.endsWith('TISpaceShipState'));
  const entries = shipGroupName ? gamestates[shipGroupName] : [];
  const rootIds = new Set();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const value = entry?.Value ?? entry?.value ?? entry;
    if (!value || typeof value !== 'object' || value.exists === false || value.archived === true) continue;
    if (!ownsConcreteWeaponObject(value)) continue;
    const id = referenceId(entry?.Key) ?? referenceId(entry?.key) ?? referenceId(value.ID) ?? referenceId(value.id);
    if (Number.isInteger(id)) rootIds.add(id);
  }

  return rootIds;
}

export function ownsConcreteWeaponObject(shipValue) {
  return ['noseWeapons', 'hullWeapons'].some(field =>
    Array.isArray(shipValue?.[field]) && shipValue[field].some(module => module && typeof module === 'object' && typeof module.$id === 'string')
  );
}

function referenceId(value) {
  if (Number.isInteger(value)) return value;
  if (!value || typeof value !== 'object') return undefined;
  const raw = value.value ?? value.Value ?? value.id ?? value.ID;
  if (Number.isInteger(raw)) return raw;
  return raw && typeof raw === 'object' ? referenceId(raw) : undefined;
}
