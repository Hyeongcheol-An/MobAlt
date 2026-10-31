'use strict';
// The Tools panel's pure helpers (src/renderer/nettools.js): MAC normalisation for the history, label length, the
// Wake-on-LAN port field, the port "Add as session" prefills and the Ports column order.
const test = require('node:test');
const assert = require('node:assert/strict');

// an ES module in a CommonJS package (see theme.test.js for the warning filter)
const printers = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') printers.forEach((p) => p(w)); });
const load = () => import('../../src/renderer/nettools.js');

test('normMac takes every spelling wol.js takes and is null while the text is not a MAC', async () => {
  const { normMac } = await load();
  for (const s of ['aa:bb:cc:dd:ee:01', 'AA-BB-CC-DD-EE-01', 'aabb.ccdd.ee01', 'AABBCCDDEE01', '  aa:bb:cc:dd:ee:01 ']) assert.equal(normMac(s), 'aa:bb:cc:dd:ee:01', s);
  for (const s of ['', 'aa:bb:cc:dd:ee', 'aa-bb:cc:dd:ee:01', 'zz:bb:cc:dd:ee:01', null, 42]) assert.equal(normMac(s), null, JSON.stringify(s));
});

test('trimLabel keeps one line of at most 40 characters', async () => {
  const { trimLabel, LABEL_MAX } = await load();
  assert.equal(LABEL_MAX, 40);
  assert.equal(trimLabel('  nas  '), 'nas');
  assert.equal(trimLabel('a\nb\t c'), 'a b c');
  assert.equal(trimLabel('x'.repeat(300)).length, 40);
  assert.equal(trimLabel('a'.repeat(39) + ' b'), 'a'.repeat(39), 'no trailing space after the cut');
  assert.equal(trimLabel(null), '');
});

test('parsePort: empty means 9; a whole number in range passes; "1.5" and "nine" are refused (never rounded to 1)', async () => {
  const { parsePort } = await load();
  assert.deepEqual(parsePort(''), { port: 9 });
  assert.deepEqual(parsePort(' 7 '), { port: 7 });
  assert.deepEqual(parsePort('65535'), { port: 65535 });
  assert.deepEqual(parsePort('1.5'), { error: 'The port must be a whole number between 1 and 65535' });
  assert.deepEqual(parsePort('nine'), { error: 'The port must be a whole number between 1 and 65535' });
  assert.deepEqual(parsePort('-9'), { error: 'The port must be a whole number between 1 and 65535' });
  assert.deepEqual(parsePort('0'), { error: 'The port must be between 1 and 65535' });
  assert.deepEqual(parsePort('70000'), { error: 'The port must be between 1 and 65535' });
});

test('sshPortOf: 22 when open, else the SSH-looking open port, else the first open port, else 22', async () => {
  const { sshPortOf } = await load();
  assert.equal(sshPortOf([22, 2222]), 22);
  assert.equal(sshPortOf([80, 2222, 443]), 2222);
  assert.equal(sshPortOf([443, 22000]), 22000);
  assert.equal(sshPortOf([80, 443]), 80);
  assert.equal(sshPortOf([]), 22);
  assert.equal(sshPortOf(undefined), 22);
});

test('comparePorts is ascending: fewer open ports first, then the lowest port', async () => {
  const { comparePorts } = await load();
  const rows = [{ ip: 'a', ports: [22, 80, 443] }, { ip: 'b', ports: [] }, { ip: 'c', ports: [80, 443] }, { ip: 'd', ports: [22, 443] }];
  assert.deepEqual([...rows].sort(comparePorts).map((r) => r.ip), ['b', 'd', 'c', 'a']);
  assert.deepEqual([...rows].sort((x, y) => -comparePorts(x, y)).map((r) => r.ip), ['a', 'c', 'd', 'b'], 'descending: the most open ports first');
});
