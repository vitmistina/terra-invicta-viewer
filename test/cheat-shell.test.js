import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const runtimeIds = [
  'cheat-template-select',
  'cheat-template-slot',
  'cheat-summary-cards',
  'cheat-weapon-exact',
  'cheat-weapon-datalist',
  'cheat-apply-weapon',
  'cheat-weapon-note',
  'cheat-source-ship',
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

test('cheat browser modules parse as JavaScript', () => {
  for (const file of ['src/cheat-app.js', 'src/cheat-template-model.js', 'src/cheat-template-mutation.js']) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
});

test('index provides the cheat mount point and cheat-app builds every runtime DOM hook', () => {
  const html = readFileSync('index.html', 'utf8');
  const app = readFileSync('src/cheat-app.js', 'utf8');
  assert.match(html, /id=["']cheat-mode["']/);
  assert.match(html, /src="\.\/src\/cheat-app\.js"/);
  assert.match(html, /href="\.\/src\/cheat\.css"/);
  for (const id of runtimeIds) {
    assert.match(app, new RegExp(`id=\\"${id}\\"`), `runtime markup missing #${id}`);
  }
});
