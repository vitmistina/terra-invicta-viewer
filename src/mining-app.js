import {
  analyzeMiningProspects,
  DEFAULT_MINING_WEIGHTS,
  MINING_RESOURCES,
  MINING_WEIGHT_PRESETS,
  normalizeMiningWeights,
  scoreMiningSites,
} from './mining-analyzer.js';
import { downloadText } from './csv.js';

const WEIGHTS_STORAGE_KEY = 'terra-invicta-mining-weights-v1';

const state = {
  analysis: undefined,
  weights: loadStoredWeights(),
  search: '',
  showClaimed: false,
  bodyId: 'all',
  sort: 'score-desc',
  mode: 'influence',
};

const elements = {
  status: document.querySelector('#status'),
  modeTabs: [...document.querySelectorAll('[data-mode]')],
  modePanels: {
    influence: document.querySelector('#influence-mode'),
    threat: document.querySelector('#threat-mode'),
    mining: document.querySelector('#mining-mode'),
  },
  perspective: document.querySelector('#mining-perspective'),
  weightInputs: [...document.querySelectorAll('[data-mining-weight]')],
  presetButtons: [...document.querySelectorAll('[data-mining-preset]')],
  searchInput: document.querySelector('#mining-search'),
  showClaimedToggle: document.querySelector('#mining-show-claimed'),
  bodySelect: document.querySelector('#mining-body'),
  sortSelect: document.querySelector('#mining-sort'),
  exportButton: document.querySelector('#export-mining-csv'),
  summaryCards: document.querySelector('#mining-summary-cards'),
  tableBody: document.querySelector('#mining-table-body'),
  diagnostics: document.querySelector('#mining-diagnostics'),
  diagnosticsList: document.querySelector('#mining-diagnostics-list'),
};

window.addEventListener('terra-invicta-save-loaded', event => analyzeLoadedSave(event.detail));

for (const tab of elements.modeTabs) {
  tab.addEventListener('click', () => {
    state.mode = tab.dataset.mode;
    queueMicrotask(renderMode);
  });
}

for (const input of elements.weightInputs) {
  input.addEventListener('input', () => {
    state.weights = normalizeMiningWeights(Object.fromEntries(elements.weightInputs.map(item => [item.dataset.miningWeight, item.value])));
    storeWeights(state.weights);
    renderMining();
  });
}

for (const button of elements.presetButtons) {
  button.addEventListener('click', () => {
    state.weights = { ...(MINING_WEIGHT_PRESETS[button.dataset.miningPreset] ?? DEFAULT_MINING_WEIGHTS) };
    storeWeights(state.weights);
    renderMining();
  });
}

elements.searchInput.addEventListener('input', event => {
  state.search = event.target.value;
  renderMining();
});

elements.showClaimedToggle.addEventListener('change', event => {
  state.showClaimed = event.target.checked;
  renderMining();
});

elements.bodySelect.addEventListener('change', event => {
  state.bodyId = event.target.value;
  renderMining();
});

elements.sortSelect.addEventListener('change', event => {
  state.sort = event.target.value;
  renderMining();
});

elements.exportButton.addEventListener('click', () => {
  if (!state.analysis) return;
  downloadText(miningRowsToCsv(currentRows()), 'mining-prospects.csv', 'text/csv;charset=utf-8');
});

renderWeightInputs();
renderMode();

function renderMode() {
  for (const [mode, panel] of Object.entries(elements.modePanels)) {
    if (panel) panel.hidden = mode !== state.mode;
  }
  for (const tab of elements.modeTabs) {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function analyzeLoadedSave(save) {
  try {
    state.analysis = analyzeMiningProspects(save.root);
    state.search = '';
    state.showClaimed = false;
    state.bodyId = 'all';
    elements.searchInput.value = '';
    elements.showClaimedToggle.checked = false;
    renderMining();
  } catch (error) {
    console.error(error);
    elements.status.textContent = `Mining analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    elements.status.dataset.type = 'error';
  }
}

function renderMining() {
  renderWeightInputs();
  if (!state.analysis) return;
  renderPerspective();
  renderBodySelect();
  const rows = currentRows();
  renderSummary(rows);
  renderTable(rows);
  renderDiagnostics();
}

function renderWeightInputs() {
  for (const input of elements.weightInputs) {
    const key = input.dataset.miningWeight;
    if (document.activeElement !== input) input.value = String(state.weights[key]);
  }
}

function renderPerspective() {
  elements.perspective.textContent = state.analysis.playerFactionName
    ? `${state.analysis.playerFactionName} · ${state.analysis.bodies.length} prospected bod${state.analysis.bodies.length === 1 ? 'y' : 'ies'}`
    : 'Player faction unresolved';
  elements.perspective.dataset.confidence = state.analysis.playerFactionId ? 'exact' : 'partial';
}

function renderBodySelect() {
  const options = [
    { value: 'all', label: 'All prospected bodies' },
    ...state.analysis.bodies.map(body => ({ value: String(body.id), label: `${body.name} (${body.siteCount})` })),
  ];
  const signature = options.map(option => `${option.value}:${option.label}`).join('|');
  if (elements.bodySelect.dataset.signature !== signature) {
    elements.bodySelect.replaceChildren(...options.map(item => {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      return option;
    }));
    elements.bodySelect.dataset.signature = signature;
  }
  if (!options.some(option => option.value === state.bodyId)) state.bodyId = 'all';
  elements.bodySelect.value = state.bodyId;
}

function renderSummary(rows) {
  const top = rows[0];
  const unclaimed = state.analysis.sites.filter(site => site.occupancyKey === 'unclaimed').length;
  const claimed = state.analysis.sites.length - unclaimed;
  const topBody = aggregateBodies(rows)[0];

  elements.summaryCards.innerHTML = [
    summaryCard('Top visible prospect', top?.name ?? '—', top ? `${top.bodyName} · score ${formatNumber(top.score, 2)}` : 'no matching site'),
    summaryCard('Best visible body', topBody?.name ?? '—', topBody ? `${formatNumber(topBody.score, 2)} combined site score` : 'no matching site'),
    summaryCard('Sites shown', `${rows.length} of ${state.analysis.sites.length}`, `${unclaimed} unclaimed known sites`),
    summaryCard('Claimed sites', state.showClaimed ? `${claimed} included` : `${claimed} hidden`, state.showClaimed ? 'toggle off to focus on available prospects' : 'toggle on to compare occupied deposits'),
  ].join('');
}

function renderTable(rows) {
  elements.tableBody.replaceChildren(...rows.map((row, index) => {
    const tr = document.createElement('tr');
    if (row.occupancyKey === 'player') tr.classList.add('selected');
    tr.append(
      numberCell(index + 1, 0),
      textCell(row.name, 'site-name'),
      textCell(row.bodyName),
      statusCell(row),
      scoreCell(row.score),
      numberCell(row.monthlyYields.water, yieldDigits(row.monthlyYields.water)),
      numberCell(row.monthlyYields.volatiles, yieldDigits(row.monthlyYields.volatiles)),
      numberCell(row.monthlyYields.metals, yieldDigits(row.monthlyYields.metals)),
      numberCell(row.monthlyYields.nobleMetals, yieldDigits(row.monthlyYields.nobleMetals)),
      numberCell(row.monthlyYields.fissiles, yieldDigits(row.monthlyYields.fissiles)),
      contributionCell(row),
    );
    return tr;
  }));

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 11;
    td.className = 'empty-cell';
    td.textContent = 'No known sites match the current filters.';
    tr.append(td);
    elements.tableBody.replaceChildren(tr);
  }
}

function renderDiagnostics() {
  const warnings = state.analysis.diagnostics.filter(item => item.level !== 'info').length;
  elements.diagnostics.querySelector('summary').textContent = `Mining diagnostics (${warnings} warning${warnings === 1 ? '' : 's'})`;
  elements.diagnosticsList.replaceChildren(...state.analysis.diagnostics.map(item => {
    const li = document.createElement('li');
    li.className = `diagnostic ${item.level}`;
    li.textContent = item.message;
    return li;
  }));
}

function currentRows() {
  if (!state.analysis) return [];
  const query = state.search.trim().toLowerCase();
  const rows = scoreMiningSites(state.analysis.sites, state.weights).filter(row => {
    const matchesSearch = !query || row.name.toLowerCase().includes(query) || row.bodyName.toLowerCase().includes(query);
    const matchesBody = state.bodyId === 'all' || String(row.bodyId) === state.bodyId;
    const matchesClaimVisibility = state.showClaimed || row.occupancyKey === 'unclaimed';
    return matchesSearch && matchesBody && matchesClaimVisibility;
  });

  return rows.sort((a, b) => {
    switch (state.sort) {
      case 'score-asc': return a.score - b.score || a.name.localeCompare(b.name);
      case 'water-desc': return b.monthlyYields.water - a.monthlyYields.water || b.score - a.score;
      case 'volatiles-desc': return b.monthlyYields.volatiles - a.monthlyYields.volatiles || b.score - a.score;
      case 'metals-desc': return b.monthlyYields.metals - a.monthlyYields.metals || b.score - a.score;
      case 'nobles-desc': return b.monthlyYields.nobleMetals - a.monthlyYields.nobleMetals || b.score - a.score;
      case 'fissiles-desc': return b.monthlyYields.fissiles - a.monthlyYields.fissiles || b.score - a.score;
      case 'yield-desc': return b.totalMonthlyYield - a.totalMonthlyYield || b.score - a.score;
      case 'body-asc': return a.bodyName.localeCompare(b.bodyName) || a.name.localeCompare(b.name);
      default: return b.score - a.score || b.monthlyYields.fissiles - a.monthlyYields.fissiles || a.name.localeCompare(b.name);
    }
  });
}

function aggregateBodies(rows) {
  const bodies = new Map();
  for (const row of rows) {
    const current = bodies.get(row.bodyId) ?? { id: row.bodyId, name: row.bodyName, score: 0, sites: 0 };
    current.score += row.score;
    current.sites += 1;
    bodies.set(row.bodyId, current);
  }
  return [...bodies.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function contributionCell(row) {
  const td = document.createElement('td');
  td.className = 'resource-driver';
  const ranked = MINING_RESOURCES
    .map(resource => ({ ...resource, value: row.contributions[resource.key] }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);
  td.textContent = ranked.length
    ? ranked.map(item => `${item.label} ${formatNumber(row.score > 0 ? item.value / row.score * 100 : 0, 0)}%`).join(' · ')
    : 'No output';
  td.title = MINING_RESOURCES.map(resource => `${resource.label}: ${formatNumber(row.contributions[resource.key], 2)} score`).join('\n');
  return td;
}

function statusCell(row) {
  const td = document.createElement('td');
  const span = document.createElement('span');
  span.className = 'site-status';
  span.dataset.status = row.occupancyKey;
  span.textContent = row.occupancyLabel;
  td.append(span);
  return td;
}

function scoreCell(value) {
  const td = numberCell(value, 2);
  td.classList.add('mining-score');
  td.title = 'Weighted monthly yield using current resource multipliers.';
  return td;
}

function summaryCard(label, value, detail) {
  return `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function textCell(value, className = '') {
  const td = document.createElement('td');
  td.textContent = value;
  td.className = className;
  return td;
}

function numberCell(value, digits) {
  const td = document.createElement('td');
  td.textContent = value === undefined ? '—' : formatNumber(value, digits);
  td.className = 'numeric';
  return td;
}

function yieldDigits(value) {
  return value > 0 && value < 1 ? 3 : 2;
}

function formatNumber(value, digits) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function miningRowsToCsv(rows) {
  const records = [[
    'Rank', 'Site', 'Body', 'Status', 'Owner', 'Weighted score',
    'Water / month', 'Volatiles / month', 'Base metals / month', 'Noble metals / month', 'Fissiles / month',
    'Water weight', 'Volatiles weight', 'Base metals weight', 'Noble metals weight', 'Fissiles weight',
  ], ...rows.map((row, index) => [
    index + 1,
    row.name,
    row.bodyName,
    row.occupancyLabel,
    row.ownerFactionName ?? '',
    row.score,
    row.monthlyYields.water,
    row.monthlyYields.volatiles,
    row.monthlyYields.metals,
    row.monthlyYields.nobleMetals,
    row.monthlyYields.fissiles,
    state.weights.water,
    state.weights.volatiles,
    state.weights.metals,
    state.weights.nobleMetals,
    state.weights.fissiles,
  ])];
  return records.map(record => record.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function loadStoredWeights() {
  try {
    const raw = localStorage.getItem(WEIGHTS_STORAGE_KEY);
    return raw ? normalizeMiningWeights(JSON.parse(raw)) : { ...DEFAULT_MINING_WEIGHTS };
  } catch {
    return { ...DEFAULT_MINING_WEIGHTS };
  }
}

function storeWeights(weights) {
  try {
    localStorage.setItem(WEIGHTS_STORAGE_KEY, JSON.stringify(weights));
  } catch {
    // Local persistence is optional; calculations continue without it.
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
