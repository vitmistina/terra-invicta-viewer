import { humanizeModuleName, replaceBuiltShipFromDonor } from './cheat-editor.js';
import { analyzeShipTemplates } from './cheat-template-model.js';
import { replaceTemplateWeapon } from './cheat-template-mutation.js';
import { buildModifiedSave, downloadBlob } from './save-writer.js';

buildCheatMarkup();

const state = {
  loadedSave: undefined,
  workingRoot: undefined,
  analysis: undefined,
  changes: [],
  selectedTemplateName: undefined,
  selectedSourceShipId: undefined,
};

const elements = {
  status: document.querySelector('#status'),
  modeTabs: [...document.querySelectorAll('[data-mode]')],
  templateSelect: document.querySelector('#cheat-template-select'),
  slotSelect: document.querySelector('#cheat-template-slot'),
  exactWeaponInput: document.querySelector('#cheat-weapon-exact'),
  weaponDatalist: document.querySelector('#cheat-weapon-datalist'),
  weaponApply: document.querySelector('#cheat-apply-weapon'),
  weaponNote: document.querySelector('#cheat-weapon-note'),
  summaryCards: document.querySelector('#cheat-summary-cards'),
  sourceSelect: document.querySelector('#cheat-source-ship'),
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

elements.templateSelect.addEventListener('change', event => {
  state.selectedTemplateName = event.target.value;
  elements.exactWeaponInput.value = '';
  renderTemplateEditor();
  renderSummary();
});

elements.slotSelect.addEventListener('change', () => {
  elements.exactWeaponInput.value = '';
  renderTemplateEditor();
});

elements.exactWeaponInput.addEventListener('input', updateWeaponButton);
elements.sourceSelect.addEventListener('change', event => {
  state.selectedSourceShipId = Number(event.target.value);
  renderDonorSelect();
  renderDonorPreview();
});
elements.donorSelect.addEventListener('change', renderDonorPreview);

elements.weaponApply.addEventListener('click', () => {
  const template = selectedTemplate();
  const slot = selectedSlot();
  const targetModuleName = elements.exactWeaponInput.value.trim();
  if (!template || !slot || !targetModuleName) return;

  try {
    const result = replaceTemplateWeapon(state.workingRoot, {
      templateName: template.templateName,
      mount: slot.mount,
      slotIndex: slot.slotIndex,
      targetModuleName,
    });
    state.workingRoot = result.root;
    state.changes.push(result.change);
    refreshAnalysis(template.templateName, state.selectedSourceShipId);
    setStatus(`Applied cheat edit: ${result.change.description}`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

elements.donorApply.addEventListener('click', () => {
  const sourceId = Number(elements.sourceSelect.value);
  const donorId = Number(elements.donorSelect.value);
  if (!Number.isInteger(sourceId) || !Number.isInteger(donorId)) return;

  try {
    const result = replaceBuiltShipFromDonor(state.workingRoot, { sourceShipId: sourceId, donorShipId: donorId });
    state.workingRoot = result.root;
    state.changes.push(result.change);
    refreshAnalysis(state.selectedTemplateName, sourceId);
    setStatus(`Applied cheat edit: ${result.change.description}`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

elements.resetButton.addEventListener('click', () => {
  if (!state.loadedSave) return;
  state.workingRoot = structuredClone(state.loadedSave.root);
  state.changes = [];
  refreshAnalysis(state.selectedTemplateName, state.selectedSourceShipId);
  setStatus('Cheat edits reset. The original loaded save was never modified.', 'success');
});

elements.downloadButton.addEventListener('click', async () => {
  if (!state.loadedSave || !state.workingRoot || !state.changes.length) return;
  elements.downloadButton.disabled = true;
  try {
    const output = await buildModifiedSave(state.loadedSave, state.workingRoot);
    downloadBlob(output.blob, output.fileName);
    const fallback = output.format === 'json5-fallback'
      ? ' Browser gzip compression is unavailable, so an uncompressed JSON save was produced.'
      : '';
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
    state.analysis = analyzeShipTemplates(state.workingRoot);
    state.selectedTemplateName = preferredInitialTemplate(state.analysis.templates)?.templateName;
    state.selectedSourceShipId = state.analysis.ships[0]?.id;
    renderCheat();
  } catch (error) {
    console.error(error);
    setStatus(`Cheat analysis failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  }
}

function refreshAnalysis(preferredTemplateName, preferredSourceShipId) {
  state.analysis = analyzeShipTemplates(state.workingRoot);
  const preferredTemplate = state.analysis.templates.find(template => template.templateName === preferredTemplateName);
  state.selectedTemplateName = preferredTemplate?.templateName ?? preferredInitialTemplate(state.analysis.templates)?.templateName;
  const preferredShip = state.analysis.ships.find(ship => ship.id === preferredSourceShipId);
  state.selectedSourceShipId = preferredShip?.id ?? state.analysis.ships[0]?.id;
  renderCheat();
}

function preferredInitialTemplate(templates) {
  return templates.find(template => template.builtShips.length > 0) ?? templates[0];
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
  if (!state.analysis) {
    elements.summaryCards.innerHTML = summaryCard('Cheat editor', 'No save loaded', 'Load a save first.');
    renderChanges();
    return;
  }

  renderTemplateSelect();
  renderTemplateEditor();
  renderModuleDatalist();
  renderSummary();
  renderSourceSelect();
  renderDonorSelect();
  renderDonorPreview();
  renderChanges();
  renderDiagnostics();
}

function renderTemplateSelect() {
  const options = state.analysis.templates.map(template => ({
    value: template.templateName,
    label: `${template.displayName} · ${template.hullName} · ${template.templateName} · ${template.builtShips.length} built`,
  }));
  replaceOptions(elements.templateSelect, options);
  if (!options.some(option => option.value === state.selectedTemplateName)) {
    state.selectedTemplateName = preferredInitialTemplate(state.analysis.templates)?.templateName;
  }
  elements.templateSelect.value = state.selectedTemplateName ?? '';
  elements.templateSelect.disabled = options.length === 0;
}

function renderTemplateEditor() {
  const template = selectedTemplate();
  const previous = elements.slotSelect.value;
  const options = (template?.slots ?? []).map(slot => ({
    value: slotKey(slot),
    label: `${capitalize(slot.mount)} slot ${slot.slotIndex}: ${humanizeModuleName(slot.moduleName)}`,
  }));
  replaceOptions(elements.slotSelect, options);
  if (options.some(option => option.value === previous)) elements.slotSelect.value = previous;

  const slot = selectedSlot();
  const affected = template?.builtShips ?? [];
  const affectedNames = affected.map(ship => ship.name).join(', ');
  elements.weaponNote.textContent = slot
    ? `${template.displayName} (${template.templateName}), ${template.hullName}. Slot ${slot.slotIndex} currently uses ${slot.moduleName}. This edits the template directly${affected.length ? ` and propagates to ${affected.length} built ship${affected.length === 1 ? '' : 's'}: ${affectedNames}` : '; no built ships currently use it'}.'`
    : 'Select a weapon slot from the template.';
  updateWeaponButton();
}

function renderModuleDatalist() {
  elements.weaponDatalist.replaceChildren(...state.analysis.moduleNames.map(moduleName => {
    const option = document.createElement('option');
    option.value = moduleName;
    return option;
  }));
}

function renderSummary() {
  const template = selectedTemplate();
  if (!template) {
    elements.summaryCards.innerHTML = summaryCard('Templates', 'None found', state.analysis.playerFactionName ?? 'Player faction unresolved');
    return;
  }
  const names = template.builtShips.map(ship => ship.name).join(' · ') || 'Future builds only';
  elements.summaryCards.innerHTML = [
    summaryCard('Selected template', template.displayName, template.templateName),
    summaryCard('Hull', template.hullName, Number.isFinite(template.refitIteration) ? `refit iteration ${template.refitIteration}` : 'dynamic ship design'),
    summaryCard('Weapon slots', String(template.slots.length), `${template.slots.filter(slot => slot.mount === 'nose').length} nose · ${template.slots.filter(slot => slot.mount === 'hull').length} hull`),
    summaryCard('Built instances', String(template.builtShips.length), names),
  ].join('');
}

function updateWeaponButton() {
  elements.weaponApply.disabled = !selectedTemplate() || !selectedSlot() || !elements.exactWeaponInput.value.trim();
}

function renderSourceSelect() {
  const options = state.analysis.ships.map(ship => ({
    value: ship.id,
    label: `${ship.name} · ${ship.designName} · ${ship.hullName} · ${ship.fleetName}`,
  }));
  replaceOptions(elements.sourceSelect, options);
  if (!options.some(option => option.value === state.selectedSourceShipId)) state.selectedSourceShipId = options[0]?.value;
  elements.sourceSelect.value = String(state.selectedSourceShipId ?? '');
  elements.sourceSelect.disabled = options.length === 0;
}

function renderDonorSelect() {
  const source = selectedSourceShip();
  const donors = state.analysis.ships
    .filter(ship => ship.id !== source?.id)
    .sort((a, b) => Number(b.hullName === source?.hullName) - Number(a.hullName === source?.hullName)
      || a.designName.localeCompare(b.designName)
      || a.name.localeCompare(b.name));
  replaceOptions(elements.donorSelect, donors.map(ship => ({
    value: ship.id,
    label: `${ship.name} · ${ship.designName} · ${ship.hullName} · ${ship.fleetName}`,
  })));
  elements.donorSelect.disabled = donors.length === 0;
  elements.donorApply.disabled = donors.length === 0;
}

function renderDonorPreview() {
  const source = selectedSourceShip();
  const donor = state.analysis?.ships.find(ship => ship.id === Number(elements.donorSelect.value));
  if (!source || !donor) {
    elements.donorPreview.textContent = 'Select source and donor ships.';
    elements.donorApply.disabled = true;
    return;
  }
  const donorTemplate = state.analysis.templates.find(template => template.templateName === donor.templateName);
  const weapons = donorTemplate?.slots.map(slot => humanizeModuleName(slot.moduleName)).join(', ') || donor.designName;
  elements.donorPreview.textContent = `Replace ${source.name} with ${donor.name}'s saved technical configuration (${donor.designName}, ${donor.hullName}). Template weapons: ${weapons}. ${source.name} keeps its own identity, fleet position and history.`;
  elements.donorApply.disabled = false;
}

function renderChanges() {
  elements.changeCount.textContent = String(state.changes.length);
  elements.downloadButton.disabled = state.changes.length === 0;
  elements.resetButton.disabled = state.changes.length === 0;
  elements.downloadHint.textContent = state.changes.length
    ? `${state.changes.length} staged edit${state.changes.length === 1 ? '' : 's'}. Download creates a new file; the loaded source remains untouched.`
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

function selectedTemplate() {
  return state.analysis?.templates.find(template => template.templateName === state.selectedTemplateName);
}

function selectedSlot() {
  const template = selectedTemplate();
  const [mount, slotText] = String(elements.slotSelect.value).split(':');
  const slotIndex = Number(slotText);
  return template?.slots.find(slot => slot.mount === mount && slot.slotIndex === slotIndex);
}

function selectedSourceShip() {
  return state.analysis?.ships.find(ship => ship.id === state.selectedSourceShipId);
}

function slotKey(slot) {
  return `${slot.mount}:${slot.slotIndex}`;
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

function buildCheatMarkup() {
  const panel = document.querySelector('#cheat-mode');
  if (!panel) return;
  panel.innerHTML = `
    <div class="mode-heading">
      <h2>Fleet and ship cheat editor <span class="cheat-badge">writes a new save</span></h2>
      <p>Edit dynamic ship templates directly, or correct one mistakenly built ship.</p>
    </div>

    <section class="cheat-warning">
      <strong>Keep the original save.</strong>
      <p>Template edits change the selected dynamic ship design and propagate the matching deployed weapon to every built instance. Every mutation happens on an in-memory copy; download creates a separate modified save.</p>
    </section>

    <div class="toolbar">
      <span class="spacer"></span>
      <button id="cheat-reset" type="button" disabled>Reset edits</button>
      <button id="cheat-download" type="button" disabled>Download modified save</button>
    </div>
    <div id="cheat-download-hint" class="cheat-download-hint">No edits yet. The loaded source save remains untouched.</div>

    <div id="cheat-summary-cards" class="summary-grid"></div>

    <div class="cheat-grid">
      <section class="cheat-card">
        <h3>Edit a ship design template</h3>
        <p>The design is the primary object. Weapon slots come directly from its saved nose/hull template entries; built ships are listed only as affected instances.</p>
        <div class="cheat-form">
          <label>Design template <select id="cheat-template-select"></select></label>
          <label>Weapon slot <select id="cheat-template-slot"></select></label>
          <label>Exact replacement module template name
            <input id="cheat-weapon-exact" type="text" list="cheat-weapon-datalist" placeholder="e.g. PointDefenseIonBattery">
            <datalist id="cheat-weapon-datalist"></datalist>
          </label>
          <div id="cheat-weapon-note" class="cheat-note"></div>
          <button id="cheat-apply-weapon" class="primary" type="button" disabled>Apply template weapon change</button>
        </div>
      </section>

      <section class="cheat-card">
        <h3>Correct one mistakenly built ship</h3>
        <p>This remains instance-level: copy another built player's ship configuration onto one mistaken hull while preserving the source ship's identity and history.</p>
        <div class="cheat-form">
          <label>Source ship <select id="cheat-source-ship"></select></label>
          <label>Donor ship configuration <select id="cheat-donor-ship"></select></label>
          <div id="cheat-donor-preview" class="cheat-note"></div>
          <button id="cheat-apply-donor" class="primary" type="button" disabled>Replace source with donor configuration</button>
        </div>
      </section>
    </div>

    <section class="panel">
      <h3>Staged edits (<span id="cheat-change-count">0</span>)</h3>
      <ul id="cheat-changes-list" class="cheat-changes"><li class="empty-change">No cheat edits staged.</li></ul>
    </section>

    <details id="cheat-diagnostics" class="panel">
      <summary>Cheat diagnostics</summary>
      <ul id="cheat-diagnostics-list"></ul>
    </details>`;
}
