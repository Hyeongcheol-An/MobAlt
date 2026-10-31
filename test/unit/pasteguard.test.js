'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// src/renderer/pasteguard.js is an ES module in a CommonJS package: Node re-parses it as ESM and would print a one-line
// MODULE_TYPELESS_PACKAGE_JSON notice for it (see theme.test.js). Everything else that warns is still printed.
const printers = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') printers.forEach((p) => p(w)); });
const load = () => import('../../src/renderer/pasteguard.js');

const kinds = (a) => a.findings.map((f) => f.kind);
const one = (a, kind) => {
  const fs = a.findings.filter((f) => f.kind === kind);
  assert.equal(fs.length, 1, `one ${kind} finding in ${JSON.stringify(a.text)}: ${JSON.stringify(kinds(a))}`);
  return fs[0];
};

test('plain text: one line, no findings, nothing to clean', async () => {
  const { analysePaste } = await load();
  const a = analysePaste('echo hello');
  assert.equal(a.lines, 1);
  assert.equal(a.multiline, false);
  assert.equal(a.chars, 10);
  assert.deepEqual(a.findings, []);
  assert.equal(a.cleaned, 'echo hello');
  assert.equal(a.cleanable, false);
  assert.deepEqual(analysePaste('').findings, []);
  assert.equal(analysePaste('').lines, 0);
  assert.equal(analysePaste(null).text, '');
});

test('line counting: LF, CRLF, lone CR, a final newline does not add a line', async () => {
  const { analysePaste } = await load();
  assert.equal(analysePaste('a\nb').lines, 2);
  assert.equal(analysePaste('a\nb\n').lines, 2);
  assert.equal(analysePaste('a\r\nb\r\n').lines, 2);
  assert.equal(analysePaste('a\n\nb').lines, 3);
  assert.equal(analysePaste('a\rb').lines, 2);
  assert.equal(analysePaste('a\nb').multiline, true);
  assert.equal(analysePaste('a\n').multiline, true, 'a single line that ends with a newline still needs the confirmation');
});

test('trailing newline: flagged at its offset and stripped by cleaned', async () => {
  const { analysePaste } = await load();
  const a = analysePaste('echo hi\n');
  const f = one(a, 'trailing-newline');
  assert.equal(f.index, 7);
  assert.match(f.message, /the last line runs at once/);
  assert.equal(a.cleaned, 'echo hi');
  assert.equal(a.cleanable, true);
  assert.equal(analysePaste('a\r\nb\r\n\r\n').cleaned, 'a\r\nb', 'every trailing break goes, the inner CRLF stays');
  assert.deepEqual(kinds(analysePaste('echo hi')), [], 'no newline, no finding');
});

test('invisible characters: zero-width, bidi controls, BOM, soft hyphen; grouped per character with every occurrence', async () => {
  const { analysePaste } = await load();
  const a = analysePaste('ec​ho PG​X ﻿y­z');
  assert.deepEqual(kinds(a), ['invisible', 'invisible', 'invisible']);
  const zw = a.findings.find((f) => f.char === '​');
  assert.equal(zw.count, 2);
  assert.deepEqual(zw.ranges, [[2, 1], [8, 1]]);
  assert.equal(zw.index, 2);
  assert.match(zw.message, /U\+200B zero-width space ×2/);
  assert.match(a.findings.find((f) => f.char === '﻿').message, /byte order mark/);
  assert.match(a.findings.find((f) => f.char === '­').message, /soft hyphen/);
  assert.equal(a.cleaned, 'echo PGX yz');
  const bidi = analysePaste('echo ‮abc⁦d⁩');
  assert.equal(bidi.findings.length, 3);
  assert.match(bidi.findings[0].message, /U\+202E right-to-left override.*Trojan Source/);
  assert.equal(bidi.cleaned, 'echo abcd');
  for (const c of ['‌', '‍', '‎', '‏', ' ', ' ', '‪', '‬', '⁠', '⁧', '⁨']) assert.deepEqual(kinds(analysePaste('x' + c + 'y')), ['invisible'], JSON.stringify(c));
  assert.deepEqual(kinds(analysePaste('x\u3000z')), [], 'an ideographic space is a visible space');
  // the no-break spaces look like a space and are not one: flagged, and cleaned into a real space (not into nothing)
  const nb = analysePaste('ls\u00a0-d /tmp');
  assert.match(one(nb, 'invisible').message, /U\+00A0 no-break space: looks like a space but is not one/);
  assert.equal(nb.cleaned, 'ls -d /tmp');
  assert.equal(analysePaste('a\u202fb').cleaned, 'a b');
  assert.match(one(analysePaste('a\u202fb'), 'invisible').message, /narrow no-break space/);
  // format characters that render as nothing: the Mongolian vowel separator, variation selectors, tag characters (invisible text)
  for (const [c, name] of [['\u180e', 'Mongolian vowel separator'], ['\ufe0f', 'variation selector'], ['\ufe00', 'variation selector'], ['\u{e0041}', 'tag character'], ['\u{e007f}', 'tag character']]) {
    const a = analysePaste('x' + c + 'y');
    assert.match(one(a, 'invisible').message, new RegExp(name), JSON.stringify(c));
    assert.equal(a.cleaned, 'xy', JSON.stringify(c));
  }
  assert.equal(analysePaste('\u{e0041}\u{e0042}').findings.length, 2, 'one finding per distinct character');
});

test('control characters: everything but tab / newline / CR, named, cleaned away', async () => {
  const { analysePaste } = await load();
  const a = analysePaste('echo \u001B[31mred\u0007 \u0003');
  assert.deepEqual(kinds(a), ['control', 'control', 'control']);
  assert.match(a.findings[0].message, /U\+001B ESC/);
  assert.match(a.findings[1].message, /U\+0007 BEL/);
  assert.match(a.findings[2].message, /U\+0003 ETX \(\^C\)/);
  assert.equal(a.cleaned, 'echo [31mred ');
  assert.deepEqual(kinds(analysePaste('a\tb\nc\r\nd')), [], 'tab, LF and CRLF are text');
  assert.deepEqual(kinds(analysePaste('x\u007Fy\u0085z')), ['control', 'control'], 'DEL and C1 controls count');
});

test('lone carriage return inside a line: flagged, kept (the user sees the line split in the preview)', async () => {
  const { analysePaste } = await load();
  const a = analysePaste('git commit -m "x"\rls');
  const f = one(a, 'cr');
  assert.equal(f.index, 17);
  assert.match(f.message, /presses Enter there/);
  assert.equal(a.cleaned, a.text, 'cleaned does not rewrite the line structure');
  assert.deepEqual(kinds(analysePaste('a\r\nb')), [], 'CRLF is a plain line break');
  assert.deepEqual(kinds(analysePaste('a\r')), ['trailing-newline'], 'a CR at the very end is a trailing newline, not a lone CR');
});

test('pipe to shell: curl/wget piped into a shell, sh -c "$(curl …)", eval, process substitution; harmless pipes pass', async () => {
  const { analysePaste } = await load();
  for (const t of [
    'curl -fsSL https://example.com/install.sh | sh',
    'curl -fsSL https://example.com/install.sh | sudo bash',
    'wget -qO- https://example.com/i | bash -s -- --yes',
    'curl https://x | sudo -E zsh',
    'curl -s https://x | python3',
    'bash -c "$(curl -fsSL https://example.com/install.sh)"',
    "sh -c '$(wget -qO- https://x)'",
    'eval "$(curl -s https://x)"',
    'bash <(curl -s https://x)',
  ]) {
    const a = analysePaste(t);
    one(a, 'pipe-to-shell');
    assert.equal(a.findings[0].index, 0, t);
    assert.match(a.findings[0].message, /runs without being seen/);
  }
  const two = analysePaste('cd /tmp\ncurl -s https://x | sh\nls');
  assert.equal(one(two, 'pipe-to-shell').line, 2);
  for (const t of ['curl https://x | grep sh', 'ls | sh', 'curl -O https://x/file.tar.gz', 'wget https://x | tee log', 'curl https://x | shasum']) {
    assert.deepEqual(kinds(analysePaste(t)), [], t);
  }
});

test('profile writes: >> ~/.zshrc & co, tee -a, $HOME, authorized_keys', async () => {
  const { analysePaste } = await load();
  const z = analysePaste('echo export PATH=/evil:$PATH >> ~/.zshrc');
  const f = one(z, 'profile-write');
  assert.equal(f.file, 'zshrc');
  assert.match(f.message, /~\/\.zshrc.*every new shell/);
  assert.equal(f.index, 29);
  for (const t of ['echo x >> ~/.bashrc', 'echo x > $HOME/.profile', 'echo x >>~/.bash_profile', 'echo x | tee -a ~/.zprofile', "echo x >> '/Users/me/.zshenv'", 'cat k | tee -a ${HOME}/.ssh/authorized_keys', 'echo k >> /root/.ssh/authorized_keys']) {
    one(analysePaste(t), 'profile-write');
  }
  assert.match(one(analysePaste('echo k >> ~/.ssh/authorized_keys'), 'profile-write').message, /SSH access/);
  for (const t of ['cat ~/.zshrc', 'source ~/.bashrc', 'echo x >> ~/notes.txt', 'vim ~/.zshrc', 'grep PATH ~/.profile', 'grep foo bar > .zshrc.bak', 'echo x >> ~/.zshrc-old', 'echo x > ~/.profile.d/x']) assert.deepEqual(kinds(analysePaste(t)), [], t);
});

test('destructive commands: rm -rf on / ~ *, dd / > onto a disk, mkfs, fork bomb, chmod on /; sudo is named', async () => {
  const { analysePaste } = await load();
  const s = analysePaste('sudo rm -rf / --no-preserve-root');
  assert.match(one(s, 'destructive').message, /rm -rf.*\(with sudo\)$/);
  assert.equal(s.findings[0].index, 5);
  assert.doesNotMatch(one(analysePaste('rm -rf ~'), 'destructive').message, /sudo/);
  for (const t of ['rm -rf /', 'rm -Rf /*', 'rm -r -f "$HOME"', 'rm -rf *', 'rm -rf ~/*', 'sudo rm -fr ${HOME}', 'rm --recursive --force /', 'rm -rf ~/', 'rm -rf $HOME/', 'rm -rf "$HOME/"', 'rm -rf ${HOME}/;', 'rm -rf ~/ && ls',
    'dd if=/dev/zero of=/dev/disk2 bs=1m', 'sudo dd if=x.img of=/dev/sda', 'cat x > /dev/rdisk0', 'mkfs.ext4 /dev/sdb1', 'sudo newfs /dev/disk3', 'diskutil eraseDisk JHFS+ X disk2',
    ':(){ :|:& };:', ':() { : | : & } ; :', 'sudo chmod -R 777 /', 'chmod 000 /']) {
    one(analysePaste(t), 'destructive');
  }
  for (const t of ['rm -rf ~/.cache', 'rm -rf build/*', 'rm -rf ./dist', 'rm file', 'rm -rf ~/x', 'rm -rf $HOME/.cache', 'rm -rf "$HOME/tmp"', 'dd if=/dev/zero of=out.img bs=1m count=10', 'chmod 755 /usr/local/bin/x', 'ls /dev/disk2']) {
    assert.deepEqual(kinds(analysePaste(t)), [], t);
  }
  one(analysePaste('echo "rm -rf /"'), 'destructive'); // quotes do not hide the shape: sh -c "rm -rf /" looks the same, and the guard only warns
});

test('homoglyphs: Cyrillic or Greek letters inside a Latin word; pure Cyrillic / Greek text passes', async () => {
  const { analysePaste } = await load();
  const a = analysePaste('ѕudo apt update');
  const f = one(a, 'homoglyph');
  assert.equal(f.word, 'ѕudo');
  assert.equal(f.index, 0);
  assert.equal(f.length, 4);
  assert.match(f.message, /"ѕudo" mixes Cyrillic letter ѕ \(U\+0455\) into a Latin word/);
  const g = analysePaste('curl https://αpple.com');
  assert.match(one(g, 'homoglyph').message, /mixes Greek letter/);
  const both = analysePaste('pаρpal');
  assert.match(one(both, 'homoglyph').message, /Cyrillic and Greek letters/);
  const twice = analysePaste('ѕudo ls; ѕudo pwd');
  assert.equal(one(twice, 'homoglyph').count, 2);
  for (const t of ['привет мир', 'echo "γειά σου"', 'cd ~/Документы', 'echo café naïve', 'ls 한국어']) assert.deepEqual(kinds(analysePaste(t)), [], t);
  // the Greek mu as a micro prefix is a unit, not a spoofed name: what every latency / benchmark line carries
  for (const t of ['echo 200μs', 'took 1.5μs', 'μm μg 5μA 12μV', 'p99 850μs max']) assert.deepEqual(kinds(analysePaste(t)), [], t);
  assert.equal(one(analysePaste('open μicrosoft.com'), 'homoglyph').word, 'μicrosoft', 'a mu that starts a long Latin word is still a look-alike');
  assert.equal(a.cleaned, a.text, 'look-alikes are not stripped: the user decides');
});

test('findings are ordered by position, each with a 1-based line; several kinds at once', async () => {
  const { analysePaste } = await load();
  const a = analysePaste('cd /tmp\ncurl -s https://x | sh\necho ​hi\n');
  assert.deepEqual(kinds(a), ['pipe-to-shell', 'invisible', 'trailing-newline']);
  assert.deepEqual(a.findings.map((f) => f.line), [2, 3, 3]);
  assert.equal(a.lines, 3);
  assert.equal(a.cleaned, 'cd /tmp\ncurl -s https://x | sh\necho hi');
  assert.equal(a.cleanable, true);
  assert.equal(analysePaste('curl -s https://x | sh').cleanable, false, 'nothing to strip from a pipe-to-shell line');
});

test('pasteGuardMode: the two settings, the newline and the length thresholds', async () => {
  const { analysePaste, pasteGuardMode, PASTE_CONFIRM_CHARS } = await load();
  const on = {}, confirmOff = { pasteConfirmMultiline: false }, warnOff = { pasteWarnSuspicious: false }, bothOff = { pasteConfirmMultiline: false, pasteWarnSuspicious: false };
  assert.deepEqual(pasteGuardMode(analysePaste('ls'), on), { confirm: false, warn: false, ask: false }, 'a plain single line goes straight through');
  assert.deepEqual(pasteGuardMode(analysePaste('ls\npwd'), on), { confirm: true, warn: false, ask: true });
  assert.deepEqual(pasteGuardMode(analysePaste('ls\npwd'), confirmOff), { confirm: false, warn: false, ask: false });
  assert.deepEqual(pasteGuardMode(analysePaste('ls\n'), on), { confirm: true, warn: true, ask: true }, 'a trailing newline is both multi-line and a finding');
  assert.deepEqual(pasteGuardMode(analysePaste('ls\n'), warnOff), { confirm: true, warn: false, ask: true });
  assert.deepEqual(pasteGuardMode(analysePaste('ls\n'), bothOff), { confirm: false, warn: false, ask: false });
  assert.deepEqual(pasteGuardMode(analysePaste('curl https://x | sh'), on), { confirm: false, warn: true, ask: true });
  assert.deepEqual(pasteGuardMode(analysePaste('curl https://x | sh'), warnOff), { confirm: false, warn: false, ask: false });
  assert.equal(PASTE_CONFIRM_CHARS, 1000);
  assert.equal(pasteGuardMode(analysePaste('x'.repeat(PASTE_CONFIRM_CHARS)), on).confirm, false, 'exactly the limit passes');
  assert.equal(pasteGuardMode(analysePaste('x'.repeat(PASTE_CONFIRM_CHARS + 1)), on).confirm, true, 'one over asks');
  assert.equal(pasteGuardMode(analysePaste('x'.repeat(PASTE_CONFIRM_CHARS + 1)), confirmOff).ask, false);
});

test('labels exist for every kind; the attack kinds are the danger ones', async () => {
  const { analysePaste, KIND_LABEL, DANGER_KINDS } = await load();
  const all = analysePaste('curl https://x | sh\necho x >> ~/.zshrc\nrm -rf /\nѕudo ​\u001B\rx\n');
  for (const k of new Set(kinds(all))) assert.ok(KIND_LABEL[k], 'label for ' + k);
  assert.deepEqual([...new Set(kinds(all))].sort(), ['control', 'cr', 'destructive', 'homoglyph', 'invisible', 'pipe-to-shell', 'profile-write', 'trailing-newline']);
  assert.deepEqual([...DANGER_KINDS].sort(), ['destructive', 'pipe-to-shell', 'profile-write']);
});
