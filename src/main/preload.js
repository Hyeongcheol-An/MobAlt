'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);
const send = (ch, ...args) => ipcRenderer.send(ch, ...args);

const EVENT_CHANNELS = [
  'term:data', 'term:exit', 'ssh:status', 'sftp:transfer', 'sftp:edit-synced', 'tunnels:changed',
  'prompt:request', 'menu:action', 'tools:output', 'tools:done', 'app:notice',
];

contextBridge.exposeInMainWorld('api', {
  on(channel, fn) {
    if (!EVENT_CHANNELS.includes(channel)) throw new Error('Unknown channel ' + channel);
    const wrapped = (_e, ...args) => fn(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  promptReply: (reqId, result) => send('prompt:reply', { reqId, result }),

  app: {
    info: () => invoke('app:info'),
    quit: () => send('app:quit'),
    screenshot: (name) => invoke('app:screenshot', name),
    testDrag: (from, to) => invoke('test:drag', { from, to }),
    testResize: (w, h) => invoke('test:resize', w, h),
    checkUpdates: () => invoke('app:check-updates'),
  },
  term: {
    spawnLocal: (opts) => invoke('term:spawn-local', opts),
    spawnTelnet: (opts) => invoke('term:spawn-telnet', opts),
    spawnSerial: (opts) => invoke('term:spawn-serial', opts),
    spawnMosh: (opts) => invoke('term:spawn-mosh', opts),
    listSerialPorts: () => invoke('serial:list'),
    write: (id, data) => send('term:write', id, data),
    resize: (id, cols, rows) => send('term:resize', id, cols, rows),
    kill: (id) => send('term:kill', id),
    logStart: (id, name) => invoke('term:log-start', id, name),
    logStop: (id) => invoke('term:log-stop', id),
  },
  ftp: {
    connect: (cfg) => invoke('ftp:connect', cfg),
    disconnect: (id) => invoke('ftp:disconnect', id),
  },
  ssh: {
    connect: (cfg, size) => invoke('ssh:connect', cfg, size),
    disconnect: (id) => invoke('ssh:disconnect', id),
    exec: (id, cmd) => invoke('ssh:exec', id, cmd),
  },
  sftp: {
    list: (id, dir) => invoke('sftp:list', id, dir),
    home: (id) => invoke('sftp:home', id),
    realpath: (id, p) => invoke('sftp:realpath', id, p),
    stat: (id, p) => invoke('sftp:stat', id, p),
    mkdir: (id, p) => invoke('sftp:mkdir', id, p),
    rename: (id, a, b) => invoke('sftp:rename', id, a, b),
    remove: (id, p, isDir) => invoke('sftp:remove', id, p, isDir),
    chmod: (id, p, mode) => invoke('sftp:chmod', id, p, mode),
    read: (id, p) => invoke('sftp:read', id, p),
    write: (id, p, content) => invoke('sftp:write', id, p, content),
    download: (id, remote, local, isDir) => invoke('sftp:download', id, remote, local, isDir),
    upload: (id, locals, remoteDir) => invoke('sftp:upload', id, locals, remoteDir),
    cancel: (tid) => invoke('sftp:cancel', tid),
    transfers: () => invoke('sftp:transfers'),
    edit: (id, remote) => invoke('sftp:edit', id, remote),
  },
  tunnels: {
    start: (spec) => invoke('tunnel:start', spec),
    stop: (id) => invoke('tunnel:stop', id),
    list: () => invoke('tunnel:list'),
  },
  sessions: {
    list: () => invoke('sessions:list'),
    save: (s) => invoke('sessions:save', s),
    saveAll: (data) => invoke('sessions:save-all', data),
    remove: (id) => invoke('sessions:delete', id),
    importSshConfig: () => invoke('sessions:import-sshconfig'),
    importMoba: () => invoke('sessions:import-moba'),
    exportJson: () => invoke('sessions:export'),
    importJson: () => invoke('sessions:import-json'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  workspace: {
    get: () => invoke('workspace:get'),
    save: (data) => send('workspace:save', data),
  },
  dialog: {
    open: (opts) => invoke('dialog:open', opts),
    save: (opts) => invoke('dialog:save', opts),
    message: (opts) => invoke('dialog:message', opts),
  },
  shell: {
    openExternal: (url) => invoke('shell:open-external', url),
    showItem: (p) => invoke('shell:show-item', p),
    openPath: (p) => invoke('shell:open-path', p),
  },
  launch: {
    rdp: (cfg) => invoke('launch:rdp', cfg),
    vnc: (cfg) => invoke('launch:vnc', cfg),
  },
  tools: {
    ping: (host, count) => invoke('tools:ping', host, count),
    traceroute: (host) => invoke('tools:traceroute', host),
    portScan: (host, from, to) => invoke('tools:portscan', host, from, to),
    lookup: (host) => invoke('tools:lookup', host),
    netinfo: () => invoke('tools:netinfo'),
    stop: (id) => invoke('tools:stop', id),
  },
  clipboard: {
    write: (t) => invoke('clipboard:write', t),
    read: () => invoke('clipboard:read'),
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
