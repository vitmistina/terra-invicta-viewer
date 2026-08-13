import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeFleetCheats,
  compatibleWeaponTargets,
  replaceBuiltShipFromDonor,
} from '../src/cheat-editor.js';
import { replaceDesignWeapon } from '../src/cheat-template-editor.js';
import { serializeTerraInvictaSave } from '../src/save-writer.js';

const ref = value => ({ value });
const entry = (id, value) => ({ Key: ref(id), Value: { ID: ref(id), exists: true, ...value } });
const moduleSlot = (id, moduleTemplateName, slotIndex) => ({ $id: String(id), moduleTemplateName, slotIndex });

function fixture() {
  const coilerDesign = {
    factionName: 'Resistance',
    hullName: 'Battlecruiser',
    dataName: 'CoilerDesign',
    friendlyName: 'Coiler',
    _displayName: 'Coiler',
    refitIteration: 0,
    moduleTemplateEntries: [{ moduleName: 'HeatSink', slot: 0 }],
    hullWeaponTemplateEntries: [
      { moduleName: 'PhaserPointDefense', slot: 0 },
      { moduleName: 'CoilgunBattery', slot: 1 },
    ],
    noseWeaponTemplateEntries: [{ moduleName: 'HeavyCoilCannon', slot: 0 }],
    fireModeTemplateEntries: [],
    disable: false,
  };
  const pdDesign = {
    factionName: 'Resistance',
    hullName: 'Battlecruiser',
    dataName: 'PDDesign',
    friendlyName: 'PD Boat',
    _displayName: 'PD Boat',
    refitIteration: 0,
    moduleTemplateEntries: [{ moduleName: 'HeatSink', slot: 0 }],
    hullWeaponTemplateEntries: [
      { moduleName: 'IonPointDefense', slot: 0 },
      { moduleName: 'LaserBattery', slot: 1 },
    ],
    noseWeaponTemplateEntries: [{ moduleName: 'LaserCannon', slot: 0 }],
    fireModeTemplateEntries: [],
    disable: false,
  };

  return {
    metadata: { marker: Infinity },
    gamestates: {
      TIFactionState: [
        entry(1, { templateName: 'ResistCouncil', player: ref(10), fleets: [ref(100)], shipDesigns: [coilerDesign, pdDesign], shipDesignCount: 2 }),
        entry(2, { templateName: 'SubmitCouncil', player: ref(20), fleets: [], shipDesigns: [] }),
      ],
      TIPlayerState: [
        entry(10, { isAI: false, faction: ref(1) }),
        entry(20, { isAI: true, faction: ref(2) }),
      ],
      TISpaceFleetState: [entry(100, { displayName: 'Earth Defense', ships: [ref(200), ref(201), ref(202)] })],
      TISpaceShipState: [
        entry(200, {
          templateName: 'CoilerDesign', displayName: 'Mistake', fleet: ref(100), fleetFormationOffset: { x: 1, y: 2, z: 3 },
          launchDate: { year: 2030 }, kills: ['Alien Corvette'], officers: [ref(500)],
          currentDeltaV_kps: 30, currentMaxDeltaV_kps: 40, currentMass_kg: 1000,
          noseWeapons: [moduleSlot(40, 'HeavyCoilCannon', 0)],
          hullWeapons: [moduleSlot(41, 'PhaserPointDefense', 0), moduleSlot(42, 'CoilgunBattery', 1)],
          utilityModules: [moduleSlot(43, 'HeatSink', 0)],
          ammo: [{ Key: { $ref: '42' }, Value: 12 }],
          propulsionValuesDataDirty: false,
        }),
        entry(201, {
          templateName: 'PDDesign', displayName: 'Guardian', fleet: ref(100), fleetFormationOffset: { x: 4, y: 5, z: 6 },
          launchDate: { year: 2031 }, kills: [], officers: [],
          currentDeltaV_kps: 45, currentMaxDeltaV_kps: 50, currentMass_kg: 900,
          noseWeapons: [moduleSlot(60, 'LaserCannon', 0)],
          hullWeapons: [moduleSlot(61, 'IonPointDefense', 0), moduleSlot(62, 'LaserBattery', 1)],
          utilityModules: [moduleSlot(63, 'HeatSink', 0)],
          ammo: [], propulsionValuesDataDirty: false,
        }),
        entry(202, {
          templateName: 'CoilerDesign', displayName: 'Coiler Two', fleet: ref(100),
          noseWeapons: [{ $ref: '40' }],
          hullWeapons: [{ $ref: '41' }, { $ref: '42' }],
          utilityModules: [{ $ref: '43' }], ammo: [],
        }),
      ],
    },
  };
}

function groupValues(root, group) {
  return root.gamestates[group].map(item => item.Value);
}

function ship(root, id) {
  return root.gamestates.TISpaceShipState.find(item => item.Key.value === id).Value;
}

function resolveJsonRef(root, value) {
  if (!value?.$ref) return value;
  let found;
  const visit = node => {
    if (found || !node || typeof node !== 'object') return;
    if (!Array.isArray(node) && node.$id === value.$ref) {
      found = node;
      return;
    }
    for (const child of Array.isArray(node) ? node : Object.values(node)) visit(child);
  };
  visit(root);
  return found;
}

test('discovers player fleets, built ships, designs, and slot-compatible weapon targets', () => {
  const analysis = analyzeFleetCheats(fixture());
  assert.equal(analysis.playerFactionId, 1);
  assert.equal(analysis.playerFactionName, 'The Resistance');
  assert.equal(analysis.fleets.length, 1);
  assert.equal(analysis.ships.length, 3);
  const targets = compatibleWeaponTargets(analysis, 200, 'hull', 0);
  assert.ok(targets.some(item => item.moduleName === 'IonPointDefense'));
});

test('weapon edit propagates through Terra Invicta shared $id/$ref module entries', () => {
  const original = fixture();
  const result = replaceDesignWeapon(original, {
    shipId: 200,
    mount: 'hull',
    slotIndex: 0,
    targetModuleName: 'IonPointDefense',
  });

  const first = ship(result.root, 200);
  const sibling = ship(result.root, 202);
  const unrelated = ship(result.root, 201);
  assert.equal(first.templateName, 'CoilerDesign');
  assert.equal(sibling.templateName, 'CoilerDesign');
  assert.equal(first.hullWeapons[0].moduleTemplateName, 'IonPointDefense');
  assert.deepEqual(sibling.hullWeapons[0], { $ref: '41' });
  assert.equal(resolveJsonRef(result.root, sibling.hullWeapons[0]).moduleTemplateName, 'IonPointDefense');
  assert.equal(unrelated.hullWeapons[0].moduleTemplateName, 'IonPointDefense');

  const faction = groupValues(result.root, 'TIFactionState')[0];
  assert.equal(faction.shipDesignCount, 2, 'template editing must not create private designs');
  assert.equal(faction.shipDesigns[0].hullWeaponTemplateEntries[0].moduleName, 'IonPointDefense');
  assert.equal(faction.shipDesigns[1].hullWeaponTemplateEntries[0].moduleName, 'IonPointDefense');
  assert.equal(result.change.affectedShipCount, 2);
  assert.deepEqual(result.change.affectedShipIds.sort((a, b) => a - b), [200, 202]);
  assert.equal(original.gamestates.TIFactionState[0].Value.shipDesigns[0].hullWeaponTemplateEntries[0].moduleName, 'PhaserPointDefense', 'source root must remain untouched');
  assert.equal(ship(original, 200).hullWeapons[0].moduleTemplateName, 'PhaserPointDefense', 'source defining module must remain untouched');
});

test('whole-ship correction copies donor technical state while preserving source identity and fleet history', () => {
  const result = replaceBuiltShipFromDonor(fixture(), { sourceShipId: 200, donorShipId: 201 });
  const edited = ship(result.root, 200);
  const donor = ship(result.root, 201);

  assert.equal(edited.ID.value, 200);
  assert.equal(edited.displayName, 'Mistake');
  assert.equal(edited.fleet.value, 100);
  assert.deepEqual(edited.fleetFormationOffset, { x: 1, y: 2, z: 3 });
  assert.deepEqual(edited.launchDate, { year: 2030 });
  assert.deepEqual(edited.kills, ['Alien Corvette']);
  assert.deepEqual(edited.officers, [ref(500)]);
  assert.equal(edited.templateName, 'PDDesign');
  assert.equal(edited.currentMaxDeltaV_kps, 50);
  assert.equal(edited.hullWeapons[0].moduleTemplateName, 'IonPointDefense');
  assert.equal(donor.displayName, 'Guardian');
  assert.equal(donor.templateName, 'PDDesign');
  assert.notEqual(edited.hullWeapons[0].$id, donor.hullWeapons[0].$id, 'cloned JSON reference ids must be fresh');
});

test('save serialization preserves Terra Invicta non-finite numeric tokens', () => {
  const text = serializeTerraInvictaSave({ positive: Infinity, negative: -Infinity, broken: NaN, finite: 4 });
  assert.ok(text.startsWith('\ufeff{'));
  assert.match(text, /"positive":Infinity/);
  assert.match(text, /"negative":-Infinity/);
  assert.match(text, /"broken":NaN/);
  assert.match(text, /"finite":4/);
});
