import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const requiredIds = [
  'cheat-mode',
  'cheat-fleet-select',
  'cheat-ship-select',
  'cheat-summary-cards',
  'cheat-weapon-slot',
  'cheat-weapon-target',
  'cheat-weapon-exact',
  'cheat-weapon-datalist',
  'cheat-apply-weapon',
  'cheat-weapon-note',
  'cheat-donor-ship',
  'cheat-donor-preview',
  'cheat-apply-donor',
  'cheat-changes-list',
  'cheat-change-count',
  'cheat-reset',
  'cheat-download',
  'cheat-download-hint',
  'cheat-diagnostics',
  'cheat-diagnostics-list',
];

test('cheat browser module parses as JavaScript', () => {
  execFileSync(process.execPath, ['--check', 'src/cheat-app.js'], { stdio: 'pipe' });
});

test('index contains every DOM hook required by cheat-app', () => {
  const html = readFileSync('index.html', 'utf8');
  for (const id of requiredIds) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /src="\.\/src\/cheat-app\.js"/);
  assert.match(html, /href="\.\/src\/cheat\.css"/);
});
