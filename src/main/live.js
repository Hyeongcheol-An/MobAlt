'use strict';
// Census of the live network connections, for the quit confirmation: SSH shells, Mosh clients and the
// SFTP companions of Mosh panes live in the terminal registry, FTP control connections in the FtpManager.

const { t, tn } = require('./i18n'); // interface language: every message shown to the user goes through t() / tn()
const LABEL = { ssh: 'SSH', mosh: 'Mosh', sftp: 'SFTP', ftp: 'FTP' };

/** @returns {{ssh:number, mosh:number, sftp:number, ftp:number, total:number}} */
function liveConnections(registry, ftp) {
  const live = {
    ssh: registry ? registry.countKind('ssh') : 0,
    mosh: registry ? registry.countKind('mosh') : 0,
    sftp: registry ? registry.countKind('sftp') : 0,
    ftp: ftp && ftp.conns ? ftp.conns.size : 0,
  };
  live.total = live.ssh + live.mosh + live.sftp + live.ftp;
  return live;
}

/**
 * The question shown before the app goes away with live connections, e.g. "2 connections are still open
 * (1 SSH, 1 FTP). Quit anyway?". `verb` is what the user chose: "Quit" (⌘Q, close button) or "Relaunch" (the banner).
 */
function quitQuestion(live, verb = t('Quit')) {
  const kinds = Object.keys(LABEL).filter((k) => live[k]).map((k) => t('{n} {kind}', { n: live[k], kind: LABEL[k] })).join(', ');
  return tn('{n} connection is still open ({kinds}). {verb} anyway?', '{n} connections are still open ({kinds}). {verb} anyway?', live.total, { kinds, verb });
}

module.exports = { liveConnections, quitQuestion };
