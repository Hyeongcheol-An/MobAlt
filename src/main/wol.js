'use strict';
// Wake-on-LAN: parse a MAC address, build the magic packet (6 × 0xFF followed by the MAC 16 times) and send it as a
// UDP broadcast. parseMac and magicPacket are pure (test/unit/wol.test.js); wake() does the sending.
const dgram = require('dgram');
const net = require('net');
const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()

/**
 * A MAC address in any of the usual spellings — `aa:bb:cc:dd:ee:ff`, `AA-BB-CC-DD-EE-FF`, Cisco's `aabb.ccdd.eeff` or
 * the bare 12 hex digits — normalised to the lower-case colon form; null when the text is not one.
 */
function parseMac(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let hex;
  if (/^[0-9a-f]{12}$/i.test(s)) hex = s;
  else if (/^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i.test(s)) hex = s.replace(/[:-]/g, '');
  else if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s)) hex = s.replace(/\./g, '');
  else return null;
  return hex.toLowerCase().match(/../g).join(':');
}

/** The 102-byte magic packet for `mac` (any spelling parseMac takes); throws on an invalid address. */
function magicPacket(mac) {
  const m = parseMac(mac);
  if (!m) throw new Error(t('Invalid MAC address: {mac}', { mac: String(mac ?? '').trim() || t('(empty)') }));
  const bytes = Buffer.from(m.replace(/:/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

/**
 * A socket error while sending (ENETUNREACH, EHOSTUNREACH, EACCES…) as a sentence for the toast: Node's own
 * "send EHOSTUNREACH 0.0.0.0:9" says nothing about the broadcast address being the thing to check.
 */
function describeSendError(e, target, port) {
  const code = e && e.code;
  const where = `${target}:${port}`;
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return new Error(t('No route to {target}; check the broadcast address ({code})', { target, code }));
  if (code === 'EACCES' || code === 'EPERM') return new Error(t('Sending to {where} is not allowed on this Mac ({code})', { where, code }));
  if (code === 'EADDRNOTAVAIL' || code === 'EINVAL') return new Error(t('Cannot send to {where}; check the broadcast address ({code})', { where, code }));
  return new Error(t('Cannot send to {where}: {error}', { where, error: code || (e && e.message) || e }));
}

/**
 * Sends the magic packet `repeat` times, `interval` ms apart, as a UDP broadcast to `broadcast`:`port` (the usual
 * 255.255.255.255:9; a directed broadcast such as 192.168.1.255 reaches another subnet when the router forwards it).
 * Resolves to { mac, broadcast, port, sent } once every packet has left; rejects on a bad address or port, or a
 * socket error (as a readable sentence, see describeSendError).
 */
function wake({ mac, broadcast = '255.255.255.255', port = 9, repeat = 3, interval = 100 } = {}) {
  return new Promise((resolve, reject) => {
    let packet;
    try { packet = magicPacket(mac); } catch (e) { return reject(e); }
    const target = String(broadcast ?? '').trim() || '255.255.255.255';
    if (!net.isIPv4(target)) return reject(new Error(t('Invalid broadcast address: {address}', { address: target })));
    if (target === '0.0.0.0') return reject(new Error(t("Invalid broadcast address: 0.0.0.0 — use 255.255.255.255 or the subnet's broadcast such as 192.168.1.255")));
    const p = port === '' || port === null || port === undefined ? 9 : Number(port);
    if (!Number.isInteger(p)) return reject(new Error(t('The port must be a whole number between 1 and 65535')));
    if (p < 1 || p > 65535) return reject(new Error(t('The port must be between 1 and 65535')));
    const socket = dgram.createSocket('udp4');
    let sent = 0, timer = null, done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (err) reject(err && err.code ? describeSendError(err, target, p) : err);
      else resolve({ mac: parseMac(mac), broadcast: target, port: p, sent });
    };
    socket.once('error', finish);
    socket.bind(() => {
      try { socket.setBroadcast(true); } catch (e) { return finish(e); }
      const sendOne = () => socket.send(packet, 0, packet.length, p, target, (err) => {
        if (err || done) return finish(err);
        sent++;
        if (sent >= repeat) return finish(null);
        timer = setTimeout(sendOne, interval);
      });
      sendOne();
    });
  });
}

module.exports = { parseMac, magicPacket, wake, describeSendError };
