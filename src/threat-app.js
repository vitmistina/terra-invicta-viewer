import { analyzeFactionThreat } from './threat-analyzer.js';
import { downloadText } from './csv.js';

const state = {
  analysis: undefined,
  selectedFactionId: undefined,
  mode: 'influence',
};

const elements = {
  status: document.querySelector('#status'),
  modeTabs: [...document.querySelectorAll('[data-mode]')],
  influenceMode: document.querySelector('#influence-mode'),
  threatMode: document.querySelector('#threat-mode'),
  factionSelect: document.querySelector('#threat-faction-select'),
  confidence: document.querySelector('#threat-confidence'),
  summaryCards: document.querySelector('#threat-summary-cards'),
  composition: document.querySelector('#threat-composition'),
  leaderboardBody: document.querySelector('#threat-leaderboard-body'),
  detailIntro: document.querySelector('#threat-detail-intro'),
  details: document.querySelector('#threat-details'),
  diagnostics: document.querySelector('#threat-diagnostics'),
  diagnosticsList: document.querySelector('#threat-diagnostics-list'),
  exportButton: document.querySelector('#export-threat-csv'),
};

window.addEventListener('terra-invicta-save-loaded', event => {
  analyzeLoadedSave(event.detail);
});

for (const tab of elements.modeTabs) {
  tab.addEventListener('click', () => {
    state.mode = tab.dataset.mode;
    renderMode();
  });
}

elements.factionSelect.addEventListener('change', event => {
  state.selectedFactionId = Number(event.target.value);
  renderThreat();
});

elements.exportButton.addEventListener('click', () => {
  if (!state.analysis) return;
  downloadText(threatRowsToCsv(state.analysis.factions), 'faction-threat-leaderboard.csv', 'text/csv;charset=utf-8');
});

renderMode();

function analyzeLoadedSave(save) {
  try {
    state.analysis = analyzeFactionThreat(save.root);
    state.selectedFactionId = state.analysis.playerFactionId ?? state.analysis.factions[0]?.id;
    renderThreat();
  } catch (error) {
    console.error(error);
    elements.status.textContent = `Threat analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    elements.status.dataset.type = 'error';
  }
}

function renderMode() {
  const influenceActive = state.mode === 'influence';
  elements.influenceMode.hidden = !influenceActive;
  elements.threatMode.hidden = influenceActive;
  for (const tab of elements.modeTabs) {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function renderThreat() {
  if (!state.analysis) return;
  replaceSelectOptions(elements.factionSelect, state.analysis.factions.map(faction => ({
    value: String(faction.id),
    label: `${faction.name}${faction.isPlayer ? ' (you)' : ''}`,
  })));
  if (!state.analysis.factions.some(faction => faction.id === state.selectedFactionId)) {
    state.selectedFactionId = state.analysis.playerFactionId ?? state.analysis.factions[0]?.id;
  }
  elements.factionSelect.value = String(state.selectedFactionId ?? '');

  const focus = selectedFaction();
  if (!focus) return;
  renderSummary(focus);
  renderComposition(focus);
  renderLeaderboard(focus);
  renderDetails(focus);
  renderDiagnostics();
}

function renderSummary(focus) {
  const ratio = focus.strongestRivalScore > 0 ? focus.total / focus.strongestRivalScore * 100 : 0;
  const marginLabel = focus.rank === 1 ? 'Lead over runner-up' : 'Gap to threat leader';
  const marginValue = focus.rank === 1 ? focus.leadOverRunnerUp : focus.gapToLead;
  const marginDetail = focus.rank === 1
    ? `${formatNumber(focus.total - focus.leadOverRunnerUp, 2)} runner-up score`
    : `${formatNumber(state.analysis.factions[0]?.total ?? 0, 2)} leader score`;
  const savedAssessment = focus.savedSelfAssessment ? `Save says: ${humanize(focus.savedSelfAssessment)}` : 'Calculated from score ratio';

  elements.summaryCards.innerHTML = [
    summaryCard('Threat score', formatNumber(focus.total, 2), `${focus.confidence} reconstruction`),
    summaryCard('Current rank', `#${focus.rank} of ${state.analysis.factions.length}`, focus.rank === 1 ? 'leading human faction' : `${formatNumber(focus.gapToLead, 2)} points behind`),
    summaryCard('Strongest rival', focus.strongestRivalName ?? '—', `${formatNumber(ratio, 1)}% of rival score`),
    summaryCard(marginLabel, formatNumber(marginValue, 2), marginDetail),
    summaryCard('Self-assessment', focus.assessment, savedAssessment),
  ].join('');

  elements.confidence.textContent = focus.unresolvedCount
    ? `${focus.unresolvedCount} unresolved asset${focus.unresolvedCount === 1 ? '' : 's'} · lower bound`
    : focus.inferredCount
      ? `${focus.inferredCount} inferred value${focus.inferredCount === 1 ? '' : 's'}`
      : 'Exact from save fields';
  elements.confidence.dataset.confidence = focus.confidence;
}

function renderComposition(focus) {
  elements.composition.innerHTML = Object.entries(focus.components).map(([key, item]) => {
    const share = focus.total > 0 ? item.score / focus.total * 100 : 0;
    const caveat = [
      item.count ? `${item.count} item${item.count === 1 ? '' : 's'}` : 'none',
      item.inferredCount ? `${item.inferredCount} inferred` : '',
      item.unresolvedCount ? `${item.unresolvedCount} unresolved` : '',
    ].filter(Boolean).join(' · ');
    return `
      <article class="composition-card" data-component="${escapeHtml(key)}">
        <div class="composition-card-header"><span>${escapeHtml(item.label)}</span><strong>${formatNumber(item.score, 2)}</strong></div>
        <div class="composition-track"><span style="width:${Math.min(100, share)}%"></span></div>
        <small>${formatNumber(share, 1)}% of total · ${escapeHtml(caveat)}</small>
      </article>
    `;
  }).join('');
}

function renderLeaderboard(focus) {
  const leaderScore = state.analysis.factions[0]?.total ?? 0;
  elements.leaderboardBody.replaceChildren(...state.analysis.factions.map(faction => {
    const tr = document.createElement('tr');
    if (faction.id === focus.id) tr.classList.add('selected');
    if (faction.rank === 1) tr.classList.add('leader');
    tr.append(
      numberCell(faction.rank, 0),
      textCell(`${faction.name}${faction.isPlayer ? ' (you)' : ''}`, 'faction-name'),
      threatNumberCell(faction.total, faction.confidence),
      numberCell(faction.components.controlPoints.score, 2),
      numberCell(faction.components.armies.score, 2),
      numberCell(faction.components.habModules.score, 2),
      numberCell(faction.components.ships.score, 2),
      numberCell(faction.components.objectives.score, 2),
      percentCell(leaderScore > 0 ? faction.total / leaderScore * 100 : 0),
      textCell(faction.savedMostPowerfulEnemyName ?? '—'),
    );
    tr.addEventListener('click', () => {
      state.selectedFactionId = faction.id;
      renderThreat();
    });
    return tr;
  }));
}

function renderDetails(focus) {
  elements.detailIntro.textContent = `${focus.name}: ${formatNumber(focus.total, 2)} total threat. Open a category to audit every included asset.`;
  const components = focus.components;
  elements.details.innerHTML = [
    threatDetail('Control points', components.controlPoints, ['Nation', 'Controlled CPs', 'Weight / CP', 'Threat', 'Source'], item => [item.name, item.controlledPoints, item.weightPerPoint, item.score, item.source]),
    threatDetail('Armies', components.armies, ['Army', 'Home nation', 'Miltech', 'Threat', 'Source'], item => [item.name, item.nationName, item.miltech, item.score, item.source]),
    threatDetail('Active hab modules', components.habModules, ['Module', 'Tier', 'Threat', 'Source'], item => [item.name, item.tier, item.score, item.source]),
    threatDetail('Ships', components.ships, ['Ship', 'Hull', 'Integrity', 'Threat', 'Source'], item => [item.name, item.hullName, item.structuralIntegrity, item.score, item.source]),
    threatDetail('Completed campaign objectives', components.objectives, ['Objective', 'Status', 'Threat', 'Source'], item => [item.name, item.status, item.score, item.source]),
  ].join('');
}

function threatDetail(title, component, headers, rowMapper) {
  const rows = component.items.length
    ? component.items.map(item => `<tr>${rowMapper(item).map((value, index) => `<td class="${typeof value === 'number' && index > 0 ? 'numeric' : ''}">${escapeHtml(typeof value === 'number' ? formatNumber(value, Number.isInteger(value) ? 0 : 2) : value)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" class="empty-cell">No scored items</td></tr>`;
  const caveats = [
    component.inferredCount ? `${component.inferredCount} inferred` : '',
    component.unresolvedCount ? `${component.unresolvedCount} unresolved and excluded` : '',
  ].filter(Boolean).join(' · ');
  return `
    <details class="threat-detail" ${title === 'Control points' ? 'open' : ''}>
      <summary><span>${escapeHtml(title)}</span><strong>${formatNumber(component.score, 2)}</strong><small>${component.count} scored${caveats ? ` · ${escapeHtml(caveats)}` : ''}</small></summary>
      <div class="table-scroll compact-table"><table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
    </details>
  `;
}

function renderDiagnostics() {
  const warnings = state.analysis.diagnostics.filter(item => item.level !== 'info').length;
  elements.diagnostics.querySelector('summary').textContent = `Threat diagnostics (${warnings} warning${warnings === 1 ? '' : 's'})`;
  elements.diagnosticsList.replaceChildren(...state.analysis.diagnostics.map(item => {
    const li = document.createElement('li');
    li.className = `diagnostic ${item.level}`;
    li.textContent = item.message;
    return li;
  }));
}

function selectedFaction() {
  return state.analysis.factions.find(faction => faction.id === state.selectedFactionId) ?? state.analysis.factions[0];
}

function replaceSelectOptions(select, options) {
  const signature = options.map(option => `${option.value}:${option.label}`).join('|');
  if (select.dataset.signature === signature) return;
  select.replaceChildren(...options.map(item => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    return option;
  }));
  select.dataset.signature = signature;
}

function threatRowsToCsv(factions) {
  const records = [[
    'Rank', 'Faction', 'Total threat', 'Control points', 'Armies', 'Active hab modules', 'Ships',
    'Completed campaign objectives', 'Confidence', 'Saved most powerful enemy', 'Saved self-assessment',
  ], ...factions.map(faction => [
    faction.rank,
    faction.name,
    faction.total,
    faction.components.controlPoints.score,
    faction.components.armies.score,
    faction.components.habModules.score,
    faction.components.ships.score,
    faction.components.objectives.score,
    faction.confidence,
    faction.savedMostPowerfulEnemyName ?? '',
    faction.savedSelfAssessment ?? '',
  ])];
  return records.map(record => record.map(csvCell).join(',')).join('\n');
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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

function threatNumberCell(value, confidence) {
  const td = numberCell(value, 2);
  td.classList.add('threat-total');
  td.title = confidence === 'partial' ? 'Lower bound: one or more assets could not be scored.' : confidence === 'estimated' ? 'Includes values inferred from template names.' : 'Exact from save fields.';
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

function humanize(value) {
  return String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
