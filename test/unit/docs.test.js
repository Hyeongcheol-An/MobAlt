'use strict';
// The README feature tables (en / ko) must keep the rows for what the user guide documents: JSON export / import,
// pane zoom and the theme that colours the whole window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const tableRows = (file) => fs.readFileSync(path.join(root, file), 'utf8').split('\n').filter((l) => /^\|.*\|$/.test(l));

for (const [file, rows] of [
  ['README.md', [/^\| Sessions export \/ import \| ✅ \| .*JSON/, /^\| Maximise a split pane \| ✅ Zoom \| ⇧⌘⏎/, /^\| Colour themes \/ dark mode \| ✅ \| .*whole window/]],
  ['README.ko.md', [/^\| 세션 내보내기 \/ 가져오기 \| ✅ \| .*JSON/, /^\| 분할 페인 최대화 \| ✅ Zoom \| ⇧⌘⏎/, /^\| 색상 테마 \/ 다크 모드 \| ✅ \| .*창 전체/]],
]) {
  test(`${file}: the feature table has rows for JSON export / import, pane zoom and the whole-window theme`, () => {
    const table = tableRows(file);
    assert.ok(table.length > 20, 'the feature table is there');
    for (const re of rows) assert.ok(table.some((l) => re.test(l)), `missing row ${re}`);
  });
}
