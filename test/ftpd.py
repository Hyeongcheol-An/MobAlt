#!/usr/bin/env python3
"""Throwaway FTP server for the FTP end-to-end test (needs `pip install pyftpdlib`).

    python3 test/ftpd.py <root-dir> [port=2121] [user=mobalt] [password=secret] [limit-bytes-per-sec=0]

Serves <root-dir> with full permissions for the given user plus read-only anonymous access.
The optional limit throttles every data connection (uploads and downloads), so a transfer lasts long
enough on localhost for the cancel checks of test/e2e-ftp.js (16000000 = ~16 MB/s). Stops when stdin
closes (the test harness kills it).
"""
import sys

from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler, ThrottledDTPHandler
from pyftpdlib.servers import FTPServer

root = sys.argv[1]
port = int(sys.argv[2]) if len(sys.argv) > 2 else 2121
user = sys.argv[3] if len(sys.argv) > 3 else "mobalt"
password = sys.argv[4] if len(sys.argv) > 4 else "secret"
limit = int(sys.argv[5]) if len(sys.argv) > 5 else 0

auth = DummyAuthorizer()
auth.add_user(user, password, root, perm="elradfmwMT")
auth.add_anonymous(root, perm="elr")

handler = FTPHandler
handler.authorizer = auth
if limit > 0:
    dtp = ThrottledDTPHandler
    dtp.read_limit = limit
    dtp.write_limit = limit
    handler.dtp_handler = dtp
handler.banner = "MobAlt test ftpd"
handler.passive_ports = range(30000, 30050)

server = FTPServer(("127.0.0.1", port), handler)
print(f"ftpd listening on 127.0.0.1:{port} root={root}", flush=True)
server.serve_forever()
