import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeMiningProspects,
  DEFAULT_MINING_WEIGHTS,
  DAYS_PER_MONTH,
  normalizeMiningWeights,
  scoreMiningSite,
} from '../src/mining-analyzer.js';

const ref = value => ({ value });
const entry = (id, value) => ({ Key: ref(id), Value: { ID: ref(id), exists: true, ...value } });

function fixture() {
  return {
    gamestates: {
      TIFactionState: [
        entry(1, {
          templateName: 'ResistCouncil',
          player: ref(10),
          intel: [
            { Key: { value: 100, $type: 'PavonisInteractive.TerraInvicta.TISpaceBodyState' }, Value: 1 },
            { Key: { value: 200, $type: 'PavonisInteractive.TerraInvicta.TISpaceBodyState' }, Value: 0.1 },
          ],
        }),
        entry(2, { templateName: 'SubmitCouncil', player: ref(20), intel: [] }),
      ],
      TIPlayerState: [
        entry(10, { isAI: false, faction: ref(1) }),
        entry(20, { isAI: true, faction: ref(2) }),
      ],
      TISpaceBodyState: [
        entry(100, { displayName: 'Ceres', habSites: [ref(101), ref(102)] }),
        entry(200, { displayName: 'Vesta', habSites: [ref(201)] }),
      ],
      TIHabSiteState: [
        entry(101, {
          displayName: 'Ceres Alpha',
          parentBody: ref(100),
          water_day: 1,
          volatiles_day: 2,
          metals_day: 3,
          nobles_day: 0.5,
          fissiles_day: 0.1,
        }),
        entry(102, {
          displayName: 'Ceres Beta',
          parentBody: ref(100),
          hab: ref(301),
          water_day: 0.5,
          volatiles_day: 0.5,
          metals_day: 1,
          nobles_day: 1,
          fissiles_day: 0,
        }),
        entry(201, {
          displayName: 'Vesta Hidden',
          parentBody: ref(200),
          water_day: 100,
          volatiles_day: 100,
          metals_day: 100,
          nobles_day: 100,
          fissiles_day: 100,
        }),
      ],
      TIHabState: [entry(301, { displayName: 'Servant Base', faction: ref(2) })],
    },
  };
}

test('selects only bodies prospected by the human player faction', () => {
  const analysis = analyzeMiningProspects(fixture());
  assert.equal(analysis.playerFactionId, 1);
  assert.equal(analysis.playerFactionName, 'The Resistance');
  assert.deepEqual(analysis.bodies.map(body => body.name), ['Ceres']);
  assert.deepEqual(analysis.sites.map(site => site.name), ['Ceres Alpha', 'Ceres Beta']);
  assert.equal(analysis.schema.prospectedBodyCount, 1);
});

test('converts daily yields to monthly output and classifies occupancy', () => {
  const analysis = analyzeMiningProspects(fixture());
  const alpha = analysis.sites.find(site => site.name === 'Ceres Alpha');
  const beta = analysis.sites.find(site => site.name === 'Ceres Beta');

  assert.equal(alpha.monthlyYields.water, DAYS_PER_MONTH);
  assert.equal(alpha.monthlyYields.nobleMetals, 0.5 * DAYS_PER_MONTH);
  assert.equal(alpha.occupancyKey, 'unclaimed');
  assert.equal(beta.occupancyKey, 'other');
  assert.equal(beta.ownerFactionName, 'The Servants');
});

test('uses rarity-aware default weights and accepts custom frontend weights', () => {
  const analysis = analyzeMiningProspects(fixture());
  const alpha = analysis.sites.find(site => site.name === 'Ceres Alpha');
  const defaultScore = scoreMiningSite(alpha);
  const expectedDailyWeighted = 1 * 1 + 2 * 1 + 3 * 0.5 + 0.5 * 3 + 0.1 * 6;
  assert.ok(Math.abs(defaultScore.score - expectedDailyWeighted * DAYS_PER_MONTH) < 1e-9);
  assert.equal(defaultScore.dominantResourceKey, 'volatiles');

  const custom = scoreMiningSite(alpha, { water: 0, volatiles: 0, metals: 0, nobleMetals: 0, fissiles: 10 });
  assert.ok(Math.abs(custom.score - 0.1 * DAYS_PER_MONTH * 10) < 1e-9);
  assert.equal(custom.dominantResourceKey, 'fissiles');
  assert.deepEqual(normalizeMiningWeights({ water: -4, fissiles: '8' }), {
    ...DEFAULT_MINING_WEIGHTS,
    water: 0,
    fissiles: 8,
  });
});

test('uses site-to-body backlinks when the body lacks habSites references', () => {
  const save = fixture();
  delete save.gamestates.TISpaceBodyState[0].Value.habSites;
  const analysis = analyzeMiningProspects(save);
  assert.equal(analysis.sites.length, 2);
});
