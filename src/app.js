import { analyzeSave, calculateScenarioReduction, findServantsFactionKey } from './analyzer.js';
import { rowsToCsv, downloadText } from './csv.js';
import { loadSaveFile } from './save-loader.js';

const state = {
  loadedSave: undefined,
  analysis: undefined,
  selectedFactionKey: undefined,
  selectedNationIds: new Set(),
  search: '',
  sort: 'monthly-desc',
  scenarioPercentagePoints: 5,
};

const elements = {
  fileInput: document.querySelector('#save-file'),
  secondaryFileInput: document.querySelector('#save-file-secondary'),
  dropZone: document.querySelector('#drop-zone'),
  landing: document.querySelector('#landing'),
  dashboard: document.querySelector('#dashboard'),
  status: document.querySelector('#status'),
  fileMeta: document.querySelector('#file-meta'),
  factionSelect: document.querySelector('#faction-select'),
  searchInput: document.querySelector('#nation-search'),
  sortSelect: document.querySelector('#sort-select'),
  scenarioInput: document.querySelector('#scenario-pp'),
  scenarioValue: document.querySelector('#scenario-value'),
  tableBody: document.querySelector('#nation-table-body'),
  summaryCards: document.querySelector('#summary-cards'),
  scenarioSummary: document.querySelector('#scenario-summary'),
  factionSummaryBody: document.querySelector('#faction-summary-body'),
  diagnostics: document.querySelector('#diagnostics'),
  diagnosticsList: document.querySelector('#diagnostics-list'),
  selectTopButton: document.querySelector('#select-top'),
  clearSelectionButton: document.querySelector('#clear-selection'),
  exportButton: document.querySelector('#export-csv'),
};

for (const input of [elements.fileInput, elements.secondaryFileInput]) {
  input.addEventListener('change', event => {
    const [file] = event.target.files;
    if (file) void openFile(file);
  });
}

elements.dropZone.addEventListener('dragover', event => {
  event.preventDefault();
  elements.dropZone.classList.add('dragging');
});

elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('dragging'));
elements.dropZone.addEventListener('drop', event => {
  event.preventDefault();
  elements.dropZone.classList.remove('dragging');
  const [file] = event.dataTransfer.files;
  if (file) void openFile(file);
});

elements.factionSelect.addEventListener('change', event => {
  state.selectedFactionKey = event.target.value;
  state.selectedNationIds.clear();
  render();
});

elements.searchInput.addEventListener('input', event => {
  state.search = event.target.value;
  renderNationTable();
});

elements.sortSelect.addEventListener('change', event => {
  state.sort = event.target.value;
  renderNationTable();
});

elements.scenarioInput.addEventListener('input', event => {
  state.scenarioPercentagePoints = Number(event.target.value);
  renderNationTable();
  renderScenarioSummary();
});

elements.selectTopButton.addEventListener('click', () => {
  state.selectedNationIds = new Set(currentRows().slice(0, 10).map(row => row.nationId));
  renderNationTable();
  renderScenarioSummary();
});

elements.clearSelectionButton.addEventListener('click', () => {
  state.selectedNationIds.clear();
  renderNationTable();
  renderScenarioSummary();
});

elements.exportButton.addEventListener('click', () => {
  const rows = currentRows();
  const faction = state.analysis.factions.find(item => item.key === state.selectedFactionKey);
  const safeName = (faction?.name ?? 'faction').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  downloadText(rowsToCsv(rows), `${safeName}-influence-by-country.csv`, 'text/csv;charset=utf-8');
});

async function openFile(file) {
  setStatus('Loading and parsing the save locally…', 'working');
  try {
    state.loadedSave = await loadSaveFile(file);
    state.analysis = analyzeSave(state.loadedSave.root);
    state.selectedFactionKey = findServantsFactionKey(state.analysis.factions);
    state.selectedNationIds.clear();
    state.search = '';
    elements.searchInput.value = '';
    elements.landing.hidden = true;
    elements.dashboard.hidden = false;
    setStatus('Save analyzed. Nothing left your browser.', 'success');
    render();
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

function render() {
  renderFileMeta();
  renderFactionSelect();
  renderSummaryCards();
  renderNationTable();
  renderFactionSummary();
  renderDiagnostics();
  renderScenarioSummary();
}

function renderFileMeta() {
  const save = state.loadedSave;
  const schema = state.analysis.schema;
  elements.fileMeta.textContent = `${save.fileName} · ${formatBytes(save.byteSize)} · ${save.format} · ${schema.objectCount.toLocaleString()} indexed objects`;
}

function renderFactionSelect() {
  const existing = new Set([...elements.factionSelect.options].map(option => option.value));
  const needed = new Set(state.analysis.factions.map(faction => faction.key));
  if (existing.size !== needed.size || [...needed].some(key => !existing.has(key))) {
    elements.factionSelect.replaceChildren(...state.analysis.factions.map(faction => {
      const option = document.createElement('option');
      option.value = faction.key;
      option.textContent = faction.name;
      return option;
    }));
  }
  elements.factionSelect.value = state.selectedFactionKey;
}

function renderSummaryCards() {
  const rows = allRowsForSelectedFaction();
  const supporters = rows.reduce((sum, row) => sum + row.supportersMillions, 0);
  const monthly = rows.reduce((sum, row) => sum + row.monthlyInfluence, 0);
  const annual = rows.reduce((sum, row) => sum + row.annualInfluence, 0);
  const leadingNation = [...rows].sort((a, b) => b.monthlyInfluence - a.monthlyInfluence)[0];

  elements.summaryCards.innerHTML = [
    summaryCard('Monthly influence', formatNumber(monthly, 2), 'from public opinion'),
    summaryCard('Annual influence', formatNumber(annual, 1), 'from public opinion'),
    summaryCard('Supporters', `${formatNumber(supporters, 1)}M`, 'worldwide'),
    summaryCard('Largest contributor', leadingNation?.nationName ?? '—', leadingNation ? `${formatNumber(leadingNation.monthlyInfluence, 2)} / month` : 'no data'),
  ].join('');
}

function renderNationTable() {
  const rows = currentRows();
  elements.scenarioValue.textContent = `${state.scenarioPercentagePoints.toFixed(1)} pp`;

  elements.tableBody.replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    if (state.selectedNationIds.has(row.nationId)) tr.classList.add('selected');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selectedNationIds.has(row.nationId);
    checkbox.setAttribute('aria-label', `Select ${row.nationName}`);
    checkbox.addEventListener('change', () => {
      checkbox.checked ? state.selectedNationIds.add(row.nationId) : state.selectedNationIds.delete(row.nationId);
      tr.classList.toggle('selected', checkbox.checked);
      renderScenarioSummary();
    });

    tr.append(
      cellWith(checkbox),
      textCell(row.nationName, 'nation-name'),
      numberCell(row.populationMillions, 1),
      percentCell(row.supportPercent),
      numberCell(row.supportersMillions, 2),
      numberCell(row.monthlyInfluence, 3),
      numberCell(row.monthlyInfluencePerPercentagePoint, 4),
      numberCell(calculateScenarioReduction(row, state.scenarioPercentagePoints), 3),
      textCell(row.controlPointOwners.length ? row.controlPointOwners.join(', ') : '—', 'owners'),
    );
    return tr;
  }));
}

function renderScenarioSummary() {
  const selectedRows = allRowsForSelectedFaction().filter(row => state.selectedNationIds.has(row.nationId));
  const before = selectedRows.reduce((sum, row) => sum + row.monthlyInfluence, 0);
  const reduction = selectedRows.reduce((sum, row) => sum + calculateScenarioReduction(row, state.scenarioPercentagePoints), 0);
  const totalFaction = allRowsForSelectedFaction().reduce((sum, row) => sum + row.monthlyInfluence, 0);
  const share = totalFaction > 0 ? reduction / totalFaction * 100 : 0;

  elements.scenarioSummary.innerHTML = `
    <strong>${selectedRows.length} selected nation${selectedRows.length === 1 ? '' : 's'}</strong>
    <span>Current contribution: ${formatNumber(before, 3)} influence/month</span>
    <span>Scenario reduction: ${formatNumber(reduction, 3)} influence/month (${formatNumber(reduction * 12, 2)}/year)</span>
    <span>Share of faction public-opinion income removed: ${formatNumber(share, 1)}%</span>
  `;
}

function renderFactionSummary() {
  elements.factionSummaryBody.replaceChildren(...state.analysis.factionSummaries.map(summary => {
    const tr = document.createElement('tr');
    tr.append(
      textCell(summary.factionName),
      numberCell(summary.supportersMillions, 2),
      numberCell(summary.monthlyInfluence, 3),
      numberCell(summary.annualInfluence, 2),
      numberCell(summary.leadingNationCount, 0),
    );
    return tr;
  }));
}

function renderDiagnostics() {
  const diagnostics = state.analysis.diagnostics;
  const warnings = diagnostics.filter(item => item.level !== 'info').length;
  elements.diagnostics.querySelector('summary').textContent = `Schema diagnostics (${warnings} warning${warnings === 1 ? '' : 's'})`;
  elements.diagnosticsList.replaceChildren(...diagnostics.map(item => {
    const li = document.createElement('li');
    li.className = `diagnostic ${item.level}`;
    li.textContent = item.message;
    return li;
  }));
}

function allRowsForSelectedFaction() {
  return state.analysis.rows.filter(row => row.factionKey === state.selectedFactionKey);
}

function currentRows() {
  const query = state.search.trim().toLowerCase();
  const rows = allRowsForSelectedFaction().filter(row => !query || row.nationName.toLowerCase().includes(query));

  return [...rows].sort((a, b) => {
    switch (state.sort) {
      case 'monthly-asc': return a.monthlyInfluence - b.monthlyInfluence;
      case 'population-desc': return b.populationMillions - a.populationMillions;
      case 'support-desc': return b.supportFraction - a.supportFraction;
      case 'marginal-desc': return b.monthlyInfluencePerPercentagePoint - a.monthlyInfluencePerPercentagePoint;
      case 'nation-asc': return a.nationName.localeCompare(b.nationName);
      default: return b.monthlyInfluence - a.monthlyInfluence;
    }
  });
}

function setStatus(message, type) {
  elements.status.textContent = message;
  elements.status.dataset.type = type;
}

function summaryCard(label, value, detail) {
  return `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function cellWith(node) {
  const td = document.createElement('td');
  td.append(node);
  return td;
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

function percentCell(value) {
  const td = numberCell(value, 2);
  td.textContent += '%';
  return td;
}

function formatNumber(value, digits) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
