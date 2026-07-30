import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeFactionThreat,
  calculateControlPointWeight,
  selfAssessment,
} from '../src/threat-analyzer.js';

const ref = value => ({ value });
const entry = (id, value) => ({ Key: ref(id), Value: { ID: ref(id), ...value } });

function fixture() {
  return {
    gamestates: {
      TIFactionState: [
        entry(1, {
          displayName: 'The Resistance',
          templateName: 'ResistCouncil',
          player: ref(101),
          controlPoints: [ref(301), ref(302)],
          armies: [ref(401)],
          habSectors: [ref(501)],
          fleets: [ref(601)],
          objectiveNames: { FirstStep: 'Completed', NextStep: 'Unlocked' },
          mostPowerfulHumanEnemy: ref(2),
          selfAssessement: 'None',
          shipDesigns: [{ dataName: 'RS_Cruiser_1', hullName: 'Cruiser' }],
        }),
        entry(2, {
          displayName: 'The Servants',
          templateName: 'SubmitCouncil',
          player: ref(102),
          controlPoints: [ref(303)],
          armies: [],
          habSectors: [],
          fleets: [],
          objectiveNames: {},
        }),
      ],
      TIPlayerState: [
        entry(101, { isAI: false, faction: ref(1) }),
        entry(102, { isAI: true, faction: ref(2) }),
      ],
      TINationState: [
        entry(10, { displayName: 'Majorland', numControlPoints_unclamped: 4, militaryTechLevel: 5 }),
        entry(20, { displayName: 'Minorland', numControlPoints_unclamped: 2, militaryTechLevel: 3 }),
      ],
      TIRegionState: [entry(11, { nation: ref(10) })],
      TIControlPoint: [
        entry(301, { faction: ref(1), nation: ref(10) }),
        entry(302, { faction: ref(1), nation: ref(10) }),
        entry(303, { faction: ref(2), nation: ref(20) }),
      ],
      TIArmyState: [entry(401, { faction: ref(1), homeRegion: ref(11), destroyed: false })],
      TISectorState: [entry(501, { habModules: [ref(502)] })],
      TIHabModuleState: [entry(502, { templateName: 'Nanofactory', tier: 2, constructionCompleted: true, powered: true, sector: ref(501) })],
      TISpaceFleetState: [entry(601, { faction: ref(1), ships: [ref(602)] })],
      TISpaceShipState: [entry(602, { displayName: 'Test cruiser', templateName: 'RS_Cruiser_1', fleet: ref(601) })],
    },
  };
}

test('calculates complete faction threat breakdown and detects the player faction', () => {
  const analysis = analyzeFactionThreat(fixture());
  const resistance = analysis.factions.find(faction => faction.name === 'The Resistance');

  assert.equal(analysis.playerFactionId, 1);
  assert.equal(resistance.components.controlPoints.score, 8);
  assert.equal(resistance.components.armies.score, 2.5);
  assert.equal(resistance.components.habModules.score, 0.6);
  assert.equal(resistance.components.ships.score, 6);
  assert.equal(resistance.components.objectives.score, 10);
  assert.equal(resistance.total, 27.1);
  assert.equal(resistance.rank, 1);
  assert.equal(resistance.savedMostPowerfulEnemyName, 'The Servants');
});

test('uses the GDP fourth-root formula when saved unclamped CP weight is absent', () => {
  assert.deepEqual(calculateControlPointWeight({ GDP: 10000 }), { value: 5, source: 'GDP formula' });
  assert.deepEqual(calculateControlPointWeight({ numControlPoints_unclamped: 6, GDP: 1 }), { value: 6, source: 'saved nation CP weight' });
});

test('only active powered completed hab modules contribute', () => {
  const save = fixture();
  save.gamestates.TIHabModuleState.push(entry(503, {
    templateName: 'ResearchCampus',
    tier: 2,
    constructionCompleted: false,
    powered: true,
    sector: ref(501),
  }));
  save.gamestates.TISectorState[0].Value.habModules.push(ref(503));
  const analysis = analyzeFactionThreat(save);
  const resistance = analysis.factions.find(faction => faction.id === 1);
  assert.equal(resistance.components.habModules.count, 1);
  assert.equal(resistance.components.habModules.score, 0.6);
});

test('applies intended self-assessment bands in threshold order', () => {
  assert.equal(selfAssessment(200, 100), 'Way ahead');
  assert.equal(selfAssessment(125, 100), 'Ahead');
  assert.equal(selfAssessment(100, 100), 'On par');
  assert.equal(selfAssessment(80, 100), 'Losing');
  assert.equal(selfAssessment(50, 100), 'Losing big');
});
