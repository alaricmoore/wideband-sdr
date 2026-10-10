from ai_agent import _execute_tool


class FakeRadio:
    def __init__(self):
        self.calls = []
        self.audio_mode = "nbfm"
        self.audio_bandwidth = None

    def status(self):
        self.calls.append(("status",))
        return {"center_hz": 100_000_000}

    def tune(self, freq_hz):
        self.calls.append(("tune", freq_hz))
        return {"ok": True}

    def fine_tune(self, offset_hz):
        self.calls.append(("fine_tune", offset_hz))
        return {"ok": True}

    def spectrum_snapshot(self):
        self.calls.append(("spectrum_snapshot",))
        return {"peaks": []}

    def scan(self, start_hz, stop_hz, step_hz=None):
        self.calls.append(("scan", start_hz, stop_hz, step_hz))
        return {"signals": []}

    def characterize(self, freq_hz=None):
        self.calls.append(("characterize", freq_hz))
        return {"freq_hz": freq_hz}

    def set_gain(self, gain):
        self.calls.append(("set_gain", gain))
        return {"ok": True}

    def set_audio_mode(self, mode):
        self.calls.append(("set_audio_mode", mode))
        self.audio_mode = mode

    def set_audio_bandwidth(self, bandwidth):
        self.calls.append(("set_audio_bandwidth", bandwidth))
        self.audio_bandwidth = bandwidth

    def effective_bandwidth(self):
        return self.audio_bandwidth if self.audio_bandwidth is not None else 16000

    def set_sample_rate(self, sample_rate):
        self.calls.append(("set_sample_rate", sample_rate))
        return {"ok": True}

    def get_signal_metrics(self):
        self.calls.append(("get_signal_metrics",))
        return {"snr_db": 20}


def test_tune_dispatch():
    r = FakeRadio()
    _execute_tool("tune", {"freq_hz": 90_000_000}, r)
    assert r.calls == [("tune", 90_000_000)]


def test_fine_tune_dispatch():
    r = FakeRadio()
    _execute_tool("fine_tune", {"offset_hz": 500}, r)
    assert r.calls == [("fine_tune", 500)]


def test_set_gain_auto_and_manual():
    r = FakeRadio()
    _execute_tool("set_gain", {"gain": "auto"}, r)
    _execute_tool("set_gain", {"gain": "20"}, r)
    assert r.calls[0] == ("set_gain", "auto")
    assert r.calls[1] == ("set_gain", 20.0)


def test_set_demod_mode_dispatch():
    r = FakeRadio()
    res = _execute_tool("set_demod_mode", {"mode": "wfm"}, r)
    assert r.calls == [("set_audio_mode", "wfm")]
    assert res["demod_mode"] == "wfm"


def test_set_bandwidth_dispatch():
    r = FakeRadio()
    res = _execute_tool("set_bandwidth", {"bandwidth_hz": 12500}, r)
    assert r.calls == [("set_audio_bandwidth", 12500)]
    assert res["bandwidth_hz"] == 12500


def test_set_sample_rate_dispatch():
    r = FakeRadio()
    _execute_tool("set_sample_rate", {"sample_rate": 250_000}, r)
    assert r.calls == [("set_sample_rate", 250_000)]


def test_get_signal_metrics_dispatch():
    r = FakeRadio()
    res = _execute_tool("get_signal_metrics", {}, r)
    assert res == {"snr_db": 20}
    assert r.calls == [("get_signal_metrics",)]


def test_scan_and_characterize_dispatch():
    r = FakeRadio()
    _execute_tool("scan", {"start_hz": 88e6, "stop_hz": 108e6}, r)
    _execute_tool("characterize", {"freq_hz": 100e6}, r)
    assert r.calls[0] == ("scan", 88_000_000, 108_000_000, None)
    assert r.calls[1] == ("characterize", 100_000_000)


def test_unknown_tool_returns_error():
    r = FakeRadio()
    res = _execute_tool("does_not_exist", {}, r)
    assert "error" in res
    assert r.calls == []
