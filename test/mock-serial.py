#!/usr/bin/env python3
"""Virtual serial device for tests: creates a pty, prints its path, and echoes
everything it receives back in upper case followed by CRLF (like a chatty device).
Usage: python3 test/mock-serial.py > /tmp/mock-serial.path &
"""
import os
import pty
import select
import sys

master, slave = pty.openpty()
print(os.ttyname(slave), flush=True)
sys.stdout.flush()
buf = b""
while True:
    r, _, _ = select.select([master], [], [], 1.0)
    if master not in r:
        continue
    try:
        data = os.read(master, 1024)
    except OSError:
        break
    if not data:
        break
    buf += data
    while b"\r" in buf or b"\n" in buf:
        idx = min(i for i in (buf.find(b"\r"), buf.find(b"\n")) if i >= 0)
        line, buf = buf[:idx], buf[idx + 1 :]
        if line:
            os.write(master, b"DEVICE> " + line.upper() + b"\r\n")
