'use strict';
// Wake-on-LAN: parse a MAC address, build the magic packet (6 × 0xFF followed by the MAC 16 times) and send it as a
// UDP broadcast. parseMac and magicPacket are pure (test/unit/wol.test.js); wake() does the sending.
const dgram = require('dgram');
const net = require('net');

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
  if (!m) throw new Error(`Invalid MAC address: ${String(mac ?? '').trim() || '(empty)'}`);
  const bytes = Buffer.from(m.replace(/:/g, ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

/**
 * Sends the magic packet `repeat` times, `interval` ms apart, as a UDP broadcast to `broadcast`:`port` (the usual
 * 255.255.255.255:9; a directed broadcast such as 192.168.1.255 reaches another subnet when the router forwards it).
 * Resolves to { mac, broadcast, port, sent } once every packet has left; rejects on a bad address or port, or a
 * socket error.
 */
function wake({ mac, broadcast = '255.255.255.255', port = 9, repeat = 3, interval = 100 } = {}) {
  return new Promise((resolve, reject) => {
    let packet;
    try { packet = magicPacket(mac); } catch (e) { return reject(e); }
    const target = String(broadcast ?? '').trim() || '255.255.255.255';
    if (!net.isIPv4(target)) return reject(new Error(`Invalid broadcast address: ${target}`));
    const p = port === '' || port === null || port === undefined ? 9 : Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return reject(new Error('The port must be between 1 and 65535'));
    const socket = dgram.createSocket('udp4');
    let sent = 0, timer = null, done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (err) reject(err);
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

module.exports = { parseMac, magicPacket, wake };
