import socket
import struct
import threading
import time

import pytest

from rtltcp import RtlTcpClient, RtlTcpError, TUNER_NAMES


class MockRtlTcp:
    """Minimal in-process rtl_tcp server: banner + command reader + IQ stream."""

    def __init__(self):
        self.commands = []
        self.stop = threading.Event()
        self.srv = socket.socket()
        self.srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(1)
        self.port = self.srv.getsockname()[1]
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        conn, _ = self.srv.accept()
        conn.sendall(b"RTL0" + struct.pack(">II", 5, 29))  # R820T, 29 gain values

        def reader():
            while not self.stop.is_set():
                try:
                    cmd = conn.recv(1)
                    if not cmd:
                        break
                    arg = b""
                    while len(arg) < 4:
                        c = conn.recv(4 - len(arg))
                        if not c:
                            return
                        arg += c
                    self.commands.append((cmd[0], struct.unpack(">I", arg)[0]))
                except OSError:
                    break

        threading.Thread(target=reader, daemon=True).start()
        buf = bytes(range(256)) * 32  # 8192 bytes of pseudo-IQ
        while not self.stop.is_set():
            try:
                conn.sendall(buf)
            except OSError:
                break
        conn.close()
        self.srv.close()

    def close(self):
        self.stop.set()


def test_rtltcp_client_protocol():
    mock = MockRtlTcp()
    try:
        c = RtlTcpClient("127.0.0.1", mock.port)
        assert c.tuner_type == 5
        assert c.gain_count == 29
        assert TUNER_NAMES[c.tuner_type] == "R820T"

        c.set_sample_rate(2_400_000)
        c.set_center_freq(100_000_000)
        c.set_gain(19.7)        # manual: gain mode 1 + gain 197 tenths
        c.set_gain_mode(False)  # auto: gain mode 0

        # Poll for the mock's reader thread to drain all 5 commands *before*
        # closing the client. Closing with unread IQ still buffered sends an
        # RST that can discard commands the reader hasn't seen yet.
        deadline = time.time() + 2.0
        while len(mock.commands) < 5 and time.time() < deadline:
            time.sleep(0.01)

        assert len(c.read_bytes(4096)) == 4096
        c.close()

        assert mock.commands[0] == (0x02, 2_400_000)    # set sample rate
        assert mock.commands[1] == (0x01, 100_000_000)   # set center freq
        assert mock.commands[2] == (0x03, 1)            # gain mode manual
        assert mock.commands[3] == (0x04, 197)         # gain tenths (19.7 dB)
        assert mock.commands[4] == (0x03, 0)            # gain mode auto
    finally:
        mock.close()


def test_rtltcp_rejects_wrong_banner():
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]

    def serve():
        conn, _ = srv.accept()
        conn.sendall(b"NOTR")  # wrong magic
        conn.close()
        srv.close()

    threading.Thread(target=serve, daemon=True).start()
    with pytest.raises(RtlTcpError):
        RtlTcpClient("127.0.0.1", port)
