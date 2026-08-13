import {
  analyzeFleetCheats,
  compatibleWeaponTargets,
  humanizeModuleName,
  replaceBuiltShipFromDonor,
  swapBuiltShipWeapon,
} from './cheat-editor.js';
import { buildModifiedSave, downloadBlob } from './save-writer.js';

const state = {
  loadedSave: undefined,
  workingRoot: undefined,
  analysis: undefined,
  changes: [],
  selectedFleetId: undefined,
  selectedShipId: undefined,
};

const elements = {
  status: document.querySelector('#status'),
  modeTabs: [...document.querySelectorAll('[data-mode]')],
  fleetSelect: document.querySelector('#cheat-fleet-select'),
  shipSelect: document.querySelector('#cheat-ship-select'),
  summaryCards: document.querySelector('#cheat-summary-cards'),
  weaponSelect: document.querySelector('#cheat-weapon-slot'),
  weaponTargetSelect: document.querySelector('#cheat-weapon-target'),
  exactWeaponInput: document.querySelector('#cheat-weapon-exact'),
  weaponDatalist: document.querySelector('#cheat-weapon-datalist'),
  weaponApply: document.querySelector('#cheat-apply-weapon'),
  weaponNote: document.querySelector('#cheat-weapon-note'),
  donorSelect: document.querySelector('#cheat-donor-ship'),
  donorPreview: document.querySelector('#cheat-donor-preview'),
  donorApply: document.querySelector('#cheat-apply-donor'),
  changesList: document.querySelector('#cheat-changes-list'),
  changeCount: document.querySelector('#cheat-change-count'),
  resetButton: document.querySelector('#cheat-reset'),
  downloadButton: document.querySelector('#cheat-download'),
  downloadHint: document.querySelector('#cheat-download-hint'),
  diagnostics: document.querySelector('#cheat-diagnostics'),
  diagnosticsList: document.querySelector('#cheat-diagnostics-list'),
};

window.addEventListener('terra-invicta-save-loaded', event => initializeSave(event.detail));

for (const tab of elements.modeTabs) {
  tab.addEventListener('click', () => renderMode(tab.dataset.mode));
}

elements.fleetSelect.addEventListener('change', event => {
  state.selectedFleetId = Number(event.target.value);
  state.selectedShipId = selectedFleet()?.ships[0]?.id;
  renderCheat();
});

elements.shipSelect.addEventListener('change', event => {
  state.selectedShipId = Number(event.target.value);
  renderCheat();
});

elements.weaponSelect.addEventListener('change', () => renderWeaponEditor());
elements.weaponTargetSelect.addEventListener('change', () => {
  elements.exactWeaponInput.value = '';
  updateWeaponButton();
});
elements.exactWeaponInput.addEventListener('input', updateWeaponButton);
elements.donorSelect.addEventListener('change', renderDonorPreview);

elements.weaponApply.addEventListener('click', () => {
  const ship = selectedShip();
  const weapon = selectedWeapon();
  if (!ship || !weapon) return;
  const exact = elements.exactWeaponInput.value.trim();
  const targetModuleName = exact || elements.weaponTargetSelect.value;
  if (!targetModuleName) return;

  try {
    const result = swapBuiltShipWeapon(state.workingRoot, {
      shipId: ship.id,
      mount: weapon.mount,
      slotIndex: weapon.slotIndex,
      targetModuleName,
      allowUnobserved: Boolean(exact),
    });
    state.workingRoot = result.root;
    state.changes.push(result.change);
    refreshAnalysis(ship.id);
    setStatus(`Applied cheat edit: ${result.change.description}`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

elements.donorApply.addEventListener('click', () => {
  const source = selectedShip();
  const donorId = Number(elements.donorSelect.value);
  if (!source || !Number.isInteger(donorId)) return;

  try {
    const result = replaceBuiltShipFromDonor(state.workingRoot, { sourceShipId: source.id, donorShipId: donorId });
    state.workingRoot = result.root;
    state.changes.push(result.change);
    refreshAnalysis(source.id);
    setStatus(`Applied cheat edit: ${result.change.description}`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

elements.resetButton.addEventListener('click', () => {
  if (!state.loadedSave) return;
  state.workingRoot = structuredClone(state.loadedSave.root);
  state.changes = [];
  refreshAnalysis(state.selectedShipId);
  setStatus('Cheat edits reset. The original loaded save was never modified.', 'success');
});

elements.downloadButton.addEventListener('click', async () => {
  if (!state.loadedSave || !state.workingRoot || !state.changes.length) return;
  elements.downloadButton.disabled = true;
  try {
    const output = await buildModifiedSave(state.loadedSave, state.workingRoot);
    downloadBlob(output.blob, output.fileName);
    const fallback = output.format === 'json5-fallback' ? ' Browser gzip compression is unavailable, so an uncompressed JSON save was produced.' : '';
    setStatus(`Modified save prepared as ${output.fileName}.${fallback}`, 'success');
  } catch (error) {
    setStatus(`Could not build modified save: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    elements.downloadButton.disabled = false;
  }
});

renderMode('influence');
renderCheat();

function initializeSave(loadedSave) {
  state.loadedSave = loadedSave;
  state.workingRoot = structuredClone(loadedSave.root);
  state.changes = [];
  try {
    state.analysis = analyzeFleetCheats(state.workingRoot);
    state.selectedFleetId = state.analysis.fleets[0]?.id;
    state.selectedShipId = state.analysis.fleets[0]?.ships[0]?.id ?? state.analysis.ships[0]?.id;
    renderCheat();
  } catch (error) {
    console.error(error);
    setStatus(`Cheat analysis failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

function refreshAnalysis(preferredShipId) {
  state.analysis = analyzeFleetCheats(state.workingRoot);
  const preferred = state.analysis.ships.find(ship => ship.id === preferredShipId);
  state.selectedShipId = preferred?.id ?? state.analysis.ships[0]?.id;
  state.selectedFleetId = preferred?.fleetId ?? state.analysis.fleets[0]?.id;
  renderCheat();
}

function renderMode(mode) {
  const panels = ['influence', 'threat', 'mining', 'cheat'];
  for (const name of panels) {
    const panel = document.querySelector(`#${name}-mode`);
    if (panel) panel.hidden = name !== mode;
  }
  for (const tab of elements.modeTabs) {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function renderCheat() {
  const enabled = Boolean(state.analysis?.playerFactionId);
  for (const element of [elements.fleetSelect, elements.shipSelect, elements.weaponSelect, elements.weaponTargetSelect, elements.exactWeaponInput, elements.donorSelect]) {
    element.disabled = !enabled;
  }
  if (!state.analysis) {
    elements.summaryCards.innerHTML = summaryCard('Cheat editor', 'No save loaded', 'Load a save first.');
    renderChanges();
    return;
  }

  renderFleetSelect();
  renderShipSelect();
  renderSummary();
  renderWeaponDatalist();
  renderWeaponEditor();
  renderDonorSelect();
  renderDonorPreview();
  renderChanges();
  renderDiagnostics();
}

function renderFleetSelect() {
  const options = state.analysis.fleets.map(fleet => ({ value: fleet.id, label: `${fleet.name} (${fleet.ships.length})` }));
  replaceOptions(elements.fleetSelect, options);
  if (!options.some(option => option.value === state.selectedFleetId)) state.selectedFleetId = options[0]?.value;
  elements.fleetSelect.value = String(state.selectedFleetId ?? '');
}

function renderShipSelect() {
  const fleet = selectedFleet();
  const options = (fleet?.ships ?? []).map(ship => ({ value: ship.id, label: `${ship.name} · ${ship.designName}` }));
  replaceOptions(elements.shipSelect, options);
  if (!options.some(option => option.value === state.selectedShipId)) state.selectedShipId = options[0]?.value;
  elements.shipSelect.value = String(state.selectedShipId ?? '');
}

function renderSummary() {
  const ship = selectedShip();
  if (!ship) {
    elements.summaryCards.innerHTML = summaryCard('Player ships', 'None found', state.analysis.playerFactionName ?? 'Player faction unresolved');
    return;
  }
  const weapons = ship.weapons.length
    ? ship.weapons.map(weapon => humanizeModuleName(weapon.moduleTemplateName)).join(' · ')
    : 'No deployed weapons found';
  const deltaV = Number.isFinite(ship.currentDeltaV) ? `${formatNumber(ship.currentDeltaV, 1)} kps` : '—';
  elements.summaryCards.innerHTML = [
    summaryCard('Selected ship', ship.name, ship.fleetName),
    summaryCard('Design', ship.designName, ship.hullName),
    summaryCard('Current delta-v', deltaV, Number.isFinite(ship.currentMaxDeltaV) ? `${formatNumber(ship.currentMaxDeltaV, 1)} kps max` : 'saved ship state'),
    summaryCard('Weapons', `${ship.weapons.length} mount${ship.weapons.length === 1 ? '' : 's'}`, weapons),
  ].join('');
}

function renderWeaponEditor() {
  const ship = selectedShip();
  const previousValue = elements.weaponSelect.value;
  const options = (ship?.weapons ?? []).map(weapon => ({
    value: weaponKey(weapon),
    label: `${capitalize(weapon.mount)} slot ${weapon.slotIndex}: ${humanizeModuleName(weapon.moduleTemplateName)}`,
  }));
  replaceOptions(elements.weaponSelect, options);
  if (options.some(option => option.value === previousValue)) elements.weaponSelect.value = previousValue;

  const weapon = selectedWeapon();
  const targets = ship && weapon ? compatibleWeaponTargets(state.analysis, ship.id, weapon.mount, weapon.slotIndex) : [];
  replaceOptions(elements.weaponTargetSelect, targets.map(target => ({
    value: target.moduleName,
    label: `${humanizeModuleName(target.moduleName)} · observed on ${target.designName}`,
  })));

  elements.weaponNote.textContent = targets.length
    ? `${targets.length} target weapon${targets.length === 1 ? '' : 's'} observed in the same hull, mount type, and slot. The edit creates a private cloned design for this ship only.`
    : 'No verified replacement was observed at this exact hull/mount/slot. Advanced exact-template input is available, but the game may reject an incompatible module.';
  updateWeaponButton();
}

function renderWeaponDatalist() {
  const moduleNames = [...new Set(state.analysis.weaponCatalog.map(item => item.moduleName))].sort((a, b) => humanizeModuleName(a).localeCompare(humanizeModuleName(b)));
  elements.weaponDatalist.replaceChildren(...moduleNames.map(moduleName => {
    const option = document.createElement('option');
    option.value = moduleName;
    option.label = humanizeModuleName(moduleName);
    return option;
  }));
}

function updateWeaponButton() {
  const hasTarget = Boolean(elements.exactWeaponInput.value.trim() || elements.weaponTargetSelect.value);
  elements.weaponApply.disabled = !selectedWeapon() || !hasTarget;
}

function renderDonorSelect() {
  const source = selectedShip();
  const donors = state.analysis.ships
    .filter(ship => ship.id !== source?.id)
    .sort((a, b) => Number(b.hullName === source?.hullName) - Number(a.hullName === source?.hullName) || a.designName.localeCompare(b.designName) || a.name.localeCompare(b.name));
  replaceOptions(elements.donorSelect, donors.map(ship => ({
    value: ship.id,
    label: `${ship.name} · ${ship.designName} · ${ship.hullName} · ${ship.fleetName}`,
  })));
  elements.donorApply.disabled = !donors.length;
}

function renderDonorPreview() {
  const donor = state.analysis?.ships.find(ship => ship.id === Number(elements.donorSelect.value));
  if (!donor) {
    elements.donorPreview.textContent = 'No donor ship available.';
    elements.donorApply.disabled = true;
    return;
  }
  const weapons = donor.weapons.map(weapon => humanizeModuleName(weapon.moduleTemplateName)).join(', ') || 'no weapons';
  elements.donorPreview.textContent = `Donor: ${donor.name}, ${donor.designName}, ${donor.hullName}. Saved weapons: ${weapons}. The source keeps its ship ID, name, fleet, launch/refit dates, kills and officers; technical state is copied from this donor.`;
  elements.donorApply.disabled = false;
}

function renderChanges() {
  elements.changeCount.textContent = String(state.changes.length);
  elements.downloadButton.disabled = state.changes.length === 0;
  elements.resetButton.disabled = state.changes.length === 0;
  elements.downloadHint.textContent = state.changes.length
    ? `${state.changes.length} unapplied-to-disk edit${state.changes.length === 1 ? '' : 's'}. Download creates a new file; the loaded source remains untouched.`
    : 'No edits yet. The loaded source save remains untouched.';
  elements.changesList.replaceChildren(...state.changes.map((change, index) => {
    const li = document.createElement('li');
    li.textContent = `${index + 1}. ${change.description}`;
    return li;
  }));
  if (!state.changes.length) {
    const li = document.createElement('li');
    li.className = 'empty-change';
    li.textContent = 'No cheat edits staged.';
    elements.changesList.append(li);
  }
}

function renderDiagnostics() {
  const warnings = state.analysis.diagnostics.filter(item => item.level !== 'info').length;
  elements.diagnostics.querySelector('summary').textContent = `Cheat diagnostics (${warnings} warning${warnings === 1 ? '' : 's'})`;
  elements.diagnosticsList.replaceChildren(...state.analysis.diagnostics.map(item => {
    const li = document.createElement('li');
    li.className = `diagnostic ${item.level}`;
    li.textContent = item.message;
    return li;
  }));
}

function selectedFleet() {
  return state.analysis?.fleets.find(fleet => fleet.id === state.selectedFleetId);
}

function selectedShip() {
  return state.analysis?.ships.find(ship => ship.id === state.selectedShipId);
}

function selectedWeapon() {
  const ship = selectedShip();
  const [mount, slotText] = String(elements.weaponSelect.value).split(':');
  const slotIndex = Number(slotText);
  return ship?.weapons.find(weapon => weapon.mount === mount && weapon.slotIndex === slotIndex);
}

function weaponKey(weapon) {
  return `${weapon.mount}:${weapon.slotIndex}`;
}

function replaceOptions(select, options) {
  const signature = options.map(option => `${option.value}:${option.label}`).join('|');
  if (select.dataset.signature === signature) return;
  const oldValue = select.value;
  select.replaceChildren(...options.map(item => {
    const option = document.createElement('option');
    option.value = String(item.value);
    option.textContent = item.label;
    return option;
  }));
  select.dataset.signature = signature;
  if (options.some(option => String(option.value) === oldValue)) select.value = oldValue;
}

function summaryCard(label, value, detail) {
  return `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function formatNumber(value, digits) {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

function setStatus(message, type) {
  elements.status.textContent = message;
  elements.status.dataset.type = type;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
