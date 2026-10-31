'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { readBundleVersion, compareVersions, bundlePath, readPlistXml, relaunchOptions } = require('../../src/main/bundlewatch');

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDisplayName</key>
    <string>MobAlt</string>
    <key>CFBundleShortVersionString</key>
    <string>0.11.0</string>
    <key>CFBundleVersion</key>
    <string>0.11.0</string>
  </dict>
</plist>
`;

test('readBundleVersion takes CFBundleShortVersionString from an XML plist', () => {
  assert.equal(readBundleVersion(PLIST), '0.11.0');
  assert.equal(readBundleVersion('<key>CFBundleShortVersionString</key><string> 1.2.3 </string>'), '1.2.3', 'tolerates whitespace');
});

test('readBundleVersion is null when the key is missing or empty', () => {
  assert.equal(readBundleVersion(PLIST.replace(/CFBundleShortVersionString/, 'CFBundleLongVersionString')), null);
  assert.equal(readBundleVersion(PLIST.replace('<string>0.11.0</string>', '<string></string>')), null);
  assert.equal(readBundleVersion(''), null);
  assert.equal(readBundleVersion(null), null);
});

test('compareVersions orders dotted versions numerically, pre-releases before their release', () => {
  assert.equal(compareVersions('0.11.0', '0.9.1'), 1, 'a string compare would put 0.9.1 first');
  assert.equal(compareVersions('0.9.1', '0.11.0'), -1);
  assert.equal(compareVersions('0.10.1', '0.10.1'), 0);
  assert.equal(compareVersions('v0.10.1', '0.10.1'), 0);
  assert.equal(compareVersions('0.10', '0.10.0'), 0);
  assert.equal(compareVersions('0.10.1-beta.1', '0.10.1'), -1);
  assert.equal(compareVersions('0.10.1', '0.10.1-beta.1'), 1);
});

test('bundlePath climbs out of Contents/MacOS', () => {
  assert.equal(bundlePath('/Applications/MobAlt.app/Contents/MacOS/MobAlt'), '/Applications/MobAlt.app');
});

test('relaunchOptions restarts a bundle through LaunchServices (open -n -a), plain relaunch without a bundle', () => {
  const bundle = '/Applications/MobAlt.app';
  const seen = [];
  const exists = (p) => { seen.push(p); return true; };
  assert.deepEqual(relaunchOptions(bundle, exists), { execPath: '/usr/bin/open', args: ['-n', '-a', bundle] });
  assert.deepEqual(seen, [path.join(bundle, 'Contents', 'Info.plist')], 'the bundle is recognised by its Info.plist');
  assert.equal(relaunchOptions(bundle, () => false), null, 'no Info.plist (running from source): caller uses app.relaunch()');
  assert.equal(relaunchOptions('/nonexistent/MobAlt.app'), null, 'default existence check against the real file system');
});

test('readPlistXml reads an XML plist as is and converts a binary one (macOS plutil)', { skip: process.platform !== 'darwin' ? 'needs plutil' : false }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobalt-plist-'));
  const xml = path.join(dir, 'Info.plist');
  fs.writeFileSync(xml, PLIST);
  assert.equal(readBundleVersion(await readPlistXml(xml)), '0.11.0');
  const bin = path.join(dir, 'Binary.plist');
  fs.copyFileSync(xml, bin);
  execFileSync('plutil', ['-convert', 'binary1', bin]);
  assert.equal(fs.readFileSync(bin).subarray(0, 6).toString('latin1'), 'bplist', 'plutil wrote a binary plist');
  assert.equal(readBundleVersion(await readPlistXml(bin)), '0.11.0');
  await assert.rejects(readPlistXml(path.join(dir, 'missing.plist')), 'a missing plist rejects (the watch treats it as "no version")');
});
