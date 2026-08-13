import { findEditableRootShipIds } from './cheat-root-ships.js';

let rootShipIds = new Set();
let filtering = false;

const shipSelect = document.querySelector('#cheat-ship-select');
const fleetSelect = document.querySelector('#cheat-fleet-select');
const verifiedTarget = document.querySelector('#cheat-weapon-target');
const exactInput = document.querySelector('#cheat-weapon-exact');
const applyButton = document.querySelector('#cheat-apply-weapon');
const weaponNote = document.querySelector('#cheat-weapon-note');

window.addEventListener('terra-invicta-save-loaded', event => {
  rootShipIds = findEditableRootShipIds(event.detail.root);
  queueMicrotask(applyExpertUi);
});

fleetSelect?.addEventListener('change', () => queueMicrotask(applyExpertUi));
shipSelect?.addEventListener('change', () => queueMicrotask(applyExpertUi));
exactInput?.addEventListener('input', syncExactOnlyState);

if (verifiedTarget) {
  const observer = new MutationObserver(() => queueMicrotask(syncExactOnlyState));
  observer.observe(verifiedTarget, { childList: true, subtree: true });
}

function applyExpertUi() {
  filterShipSelectorToRoots();
  configureExactOnlyWeaponSelector();
}

function filterShipSelectorToRoots() {
  if (!shipSelect || filtering) return;
  filtering = true;
  try {
    const options = [...shipSelect.options];
    const rootOptions = options.filter(option => rootShipIds.has(Number(option.value)));

    for (const option of options) {
      if (!rootShipIds.has(Number(option.value))) option.remove();
    }

    if (!rootOptions.length) {
      shipSelect.replaceChildren(new Option('No root ship with concrete $id weapon state in this fleet', '', true, true));
      shipSelect.disabled = true;
      return;
    }

    shipSelect.disabled = false;
    if (!rootShipIds.has(Number(shipSelect.value))) {
      shipSelect.value = rootOptions[0].value;
      shipSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } finally {
    filtering = false;
  }
}

function configureExactOnlyWeaponSelector() {
  if (verifiedTarget) {
    verifiedTarget.closest('label')?.setAttribute('hidden', '');
  }
  if (exactInput) {
    const label = exactInput.closest('label');
    if (label?.firstChild?.nodeType === Node.TEXT_NODE) {
      label.firstChild.nodeValue = 'Replacement module template\n                ';
    }
    exactInput.placeholder = 'Exact moduleTemplateName, e.g. PointDefenseIonBattery';
  }
  syncExactOnlyState();
}

function syncExactOnlyState() {
  if (verifiedTarget) {
    verifiedTarget.selectedIndex = -1;
    verifiedTarget.disabled = true;
  }
  if (applyButton) applyButton.disabled = !exactInput?.value.trim();
  if (weaponNote) {
    weaponNote.textContent = 'Exact-template mode only. Enter the target moduleTemplateName directly. The selected design template is changed and propagated through the save\'s $id/$ref graph.';
  }
}
