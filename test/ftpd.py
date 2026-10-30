#!/usr/bin/env python3
"""Throwaway FTP server for the FTP end-to-end test (needs `pip install pyftpdlib`).

    python3 test/ftpd.py <root-dir> [port=2121] [user=mobalt] [password=secret]

Serves <root-dir> with full permissions for the given user plus read-only anonymous access.
Stops when stdin closes (the test harness kills it).
"""
import sys

from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer

root = sys.argv[1]
port = int(sys.argv[2]) if len(sys.argv) > 2 else 2121
user = sys.argv[3] if len(sys.argv) > 3 else "mobalt"
password = sys.argv[4] if len(sys.argv) > 4 else "secret"

auth = DummyAuthorizer()
auth.add_user(user, password, root, perm="elradfmwMT")
auth.add_anonymous(root, perm="elr")

handler = FTPHandler
handler.authorizer = auth
handler.banner = "MobAlt test ftpd"
handler.passive_ports = range(30000, 30050)

server = FTPServer(("127.0.0.1", port), handler)
print(f"ftpd listening on 127.0.0.1:{port} root={root}", flush=True)
server.serve_forever()
