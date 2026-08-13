import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeShipTemplates } from '../src/cheat-template-model.js';
import { replaceTemplateWeapon } from '../src/cheat-template-mutation.js';

const ref = value => ({ value });
const stateEntry = (id, value) => ({ Key: ref(id), Value: { ID: ref(id), exists: true, ...value } });

function fixture() {
  const design = {
    dataName: 'playerShipTemplate15',
    _displayName: 'Zeta P',
    hullName: 'Dreadnought',
    disable: false,
    refitIteration: 0,
    moduleTemplateEntries: [],
    noseWeaponTemplateEntries: [{ moduleName: '720cmUVArcLaserCannon', slot: 8 }],
    hullWeaponTemplateEntries: [
      { moduleName: 'PointDefensePhaserTurret', slot: 16 },
      { moduleName: '40mmAutocannon', slot: 19 },
    ],
    fireModeTemplateEntries: [],
  };

  return {
    gamestates: {
      TIFactionState: [stateEntry(1, {
        templateName: 'ResistCouncil',
        player: ref(10),
        fleets: [ref(100)],
        shipDesigns: [design],
        shipDesignCount: 1,
      })],
      TIPlayerState: [stateEntry(10, { isAI: false, faction: ref(1) })],
      TISpaceFleetState: [stateEntry(100, { displayName: 'Earth Defense', ships: [ref(200), ref(201)] })],
      TISpaceShipState: [
        stateEntry(200, {
          templateName: 'playerShipTemplate15',
          displayName: 'Gaugamela',
          fleet: ref(100),
          noseWeapons: [{ $id: '500', moduleTemplateName: '720cmUVArcLaserCannon', slotIndex: 8 }],
          hullWeapons: [
            { $id: '501', moduleTemplateName: 'PointDefensePhaserTurret', slotIndex: 16 },
            { $id: '502', moduleTemplateName: '40mmAutocannon', slotIndex: 19 },
          ],
          utilityModules: [],
          ammo: [],
          propulsionValuesDataDirty: false,
        }),
        stateEntry(201, {
          templateName: 'playerShipTemplate15',
          displayName: 'Kokoda',
          fleet: ref(100),
          noseWeapons: [{ $ref: '500' }],
          hullWeapons: [{ $ref: '501' }, { $ref: '502' }],
          utilityModules: [],
          ammo: [],
          propulsionValuesDataDirty: false,
        }),
      ],
    },
  };
}

function faction(root) {
  return root.gamestates.TIFactionState[0].Value;
}

function ship(root, id) {
  return root.gamestates.TISpaceShipState.find(entry => entry.Key.value === id).Value;
}

test('template analysis makes the design the primary editable object', () => {
  const analysis = analyzeShipTemplates(fixture());
  assert.equal(analysis.templates.length, 1);
  const template = analysis.templates[0];
  assert.equal(template.templateName, 'playerShipTemplate15');
  assert.equal(template.displayName, 'Zeta P');
  assert.equal(template.hullName, 'Dreadnought');
  assert.deepEqual(template.builtShips.map(item => item.name).sort(), ['Gaugamela', 'Kokoda']);
  assert.ok(template.slots.some(slot => slot.mount === 'hull' && slot.slotIndex === 16 && slot.moduleName === 'PointDefensePhaserTurret'));
});

test('exact template edit updates the design and shared deployed module definition behind sibling refs', () => {
  const original = fixture();
  const result = replaceTemplateWeapon(original, {
    templateName: 'playerShipTemplate15',
    mount: 'hull',
    slotIndex: 16,
    targetModuleName: 'PointDefenseIonBattery',
  });

  assert.equal(faction(result.root).shipDesigns[0].hullWeaponTemplateEntries[0].moduleName, 'PointDefenseIonBattery');
  assert.equal(ship(result.root, 200).hullWeapons[0].moduleTemplateName, 'PointDefenseIonBattery');
  assert.deepEqual(ship(result.root, 201).hullWeapons[0], { $ref: '501' }, 'sibling keeps its JSON reference wrapper');
  assert.equal(result.change.affectedShipCount, 2);
  assert.deepEqual(result.change.affectedShipNames.sort(), ['Gaugamela', 'Kokoda']);

  assert.equal(faction(original).shipDesigns[0].hullWeaponTemplateEntries[0].moduleName, 'PointDefensePhaserTurret', 'source save remains untouched');
  assert.equal(ship(original, 200).hullWeapons[0].moduleTemplateName, 'PointDefensePhaserTurret');
});
