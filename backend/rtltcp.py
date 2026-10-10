"""Minimal client for the classic rtl_tcp (librtlsdr) binary protocol.

pyrtlsdr's ``RtlSdrTcpClient`` speaks a *different*, JSON-based protocol that is
only compatible with its own ``RtlSdrTcpServer`` — not with the standard
``rtl_tcp`` server shipped by librtlsdr. This module implements the real wire
protocol directly (about 80 lines).

Protocol summary (see librtlsdr's rtl_tcp.c):
  * On connect the server sends a 12-byte banner:
      "RTL0" (4 bytes) + tuner_type (uint32 BE) + gain_count (uint32 BE).
  * The client then sends binary commands; each is a 1-byte opcode followed by a
    big-endian uint32 argument. There are no responses.
  * The server continuously streams interleaved uint8 I/Q samples.
"""
import socket
import struct

CMD_SET_FREQ = 0x01
CMD_SET_SAMPLE_RATE = 0x02
CMD_SET_GAIN_MODE = 0x03
CMD_SET_GAIN = 0x04
CMD_SET_FREQ_CORRECTION = 0x05
CMD_SET_AGC_MODE = 0x08
CMD_SET_DIRECT_SAMPLING = 0x09

TUNER_NAMES = {
    0: "unknown",
    1: "E4000",
    2: "FC0012",
    3: "FC0013",
    4: "FC2580",
    5: "R820T",
    6: "R828D",
}


class RtlTcpError(RuntimeError):
    pass


class RtlTcpClient:
    def __init__(self, host, port, timeout=5.0):
        self.host = host
        self.port = port
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self.closed = False
        self.tuner_type, self.gain_count = self._read_banner()

    # ---- low-level IO ----
    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise RtlTcpError("rtl_tcp closed the connection")
            buf += chunk
        return buf

    def _read_banner(self):
        data = self._recv_exact(12)
        if data[:4] != b"RTL0":
            raise RtlTcpError(f"not an rtl_tcp server (banner {data[:4]!r})")
        tuner = struct.unpack(">I", data[4:8])[0]
        gains = struct.unpack(">I", data[8:12])[0]
        return tuner, gains

    def _send(self, cmd, value):
        self.sock.sendall(bytes([cmd]) + struct.pack(">I", value & 0xFFFFFFFF))

    # ---- control commands ----
    def set_center_freq(self, freq_hz):
        self._send(CMD_SET_FREQ, int(freq_hz))

    def set_sample_rate(self, rate_hz):
        self._send(CMD_SET_SAMPLE_RATE, int(rate_hz))

    def set_gain_mode(self, manual):
        self._send(CMD_SET_GAIN_MODE, 1 if manual else 0)

    def set_gain(self, gain_db):
        # rtl_tcp divides the received value by 10 -> send tenths of a dB.
        self.set_gain_mode(True)
        self._send(CMD_SET_GAIN, int(round(float(gain_db) * 10)))

    def set_freq_correction(self, ppm):
        self._send(CMD_SET_FREQ_CORRECTION, int(ppm))

    # ---- sample stream ----
    def read_bytes(self, num_bytes):
        return self._recv_exact(num_bytes)

    def close(self):
        if not self.closed:
            try:
                self.sock.close()
            except Exception:
                pass
            self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
