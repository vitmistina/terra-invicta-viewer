import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSave,
  calculateScenarioReduction,
  findServantsFactionKey,
} from '../src/analyzer.js';

const ref = value => ({ value });
const entry = (id, value) => ({ Key: ref(id), Value: { ID: ref(id), ...value } });

test('calculates country and global influence from region population and public opinion', () => {
  const save = {
    gamestates: {
      'PavonisInteractive.TerraInvicta.TINationState': [
        entry(1, {
          displayName: 'Nation A',
          regions: [ref(11), ref(12)],
          publicOpinion: { Submit: 0.25, Resist: 0.5, Undecided: 0.25 },
        }),
        entry(2, {
          displayName: 'Nation B',
          regions: [ref(13)],
          publicOpinion: { Submit: 0.5, Resist: 0.25, Undecided: 0.25 },
        }),
      ],
      'PavonisInteractive.TerraInvicta.TIRegionState': [
        entry(11, { nation: ref(1), populationInMillions: 70 }),
        entry(12, { nation: ref(1), populationInMillions: 50 }),
        entry(13, { nation: ref(2), populationInMillions: 24 }),
      ],
      'PavonisInteractive.TerraInvicta.TIFactionState': [],
      'PavonisInteractive.TerraInvicta.TIControlPoint': [],
    },
  };

  const analysis = analyzeSave(save);
  const servantsKey = findServantsFactionKey(analysis.factions);
  const servantsRows = analysis.rows.filter(row => row.factionKey === servantsKey);
  const nationA = servantsRows.find(row => row.nationName === 'Nation A');
  const nationB = servantsRows.find(row => row.nationName === 'Nation B');

  assert.equal(nationA.populationMillions, 120);
  assert.equal(nationA.supportersMillions, 30);
  assert.equal(nationA.monthlyInfluence, 1.25);
  assert.equal(nationB.monthlyInfluence, 0.5);

  const summary = analysis.factionSummaries.find(item => item.factionKey === servantsKey);
  assert.equal(summary.monthlyInfluence, 1.75);
  assert.equal(calculateScenarioReduction(nationA, 5), 0.25);
});

test('uses region backlinks when nation region references are absent', () => {
  const save = {
    gamestates: {
      TINationState: [entry(1, { displayName: 'Backlinkia', publicOpinion: { Submit: 0.1, Undecided: 0.9 } })],
      TIRegionState: [entry(11, { nation: ref(1), populationInMillions: 10 })],
    },
  };

  const analysis = analyzeSave(save);
  assert.equal(analysis.nations[0].populationMillions, 10);
});

test('reports invalid opinion totals without silently normalizing them', () => {
  const save = {
    gamestates: {
      TINationState: [entry(1, { displayName: 'Oddland', populationInMillions: 10, publicOpinion: { Submit: 0.2, Undecided: 0.2 } })],
      TIRegionState: [],
    },
  };

  const analysis = analyzeSave(save);
  assert.ok(analysis.diagnostics.some(item => item.message.includes('sums to')));
  assert.equal(analysis.nations[0].opinionTotal, 0.4);
});
