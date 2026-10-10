"""Ollama agent: lets the model call SDR tools (tune / scan / characterize / etc.)."""
import json

import requests

import config
import dsp

SYSTEM_PROMPT = """You are the operator assistant for a software-defined radio (RTL-SDR dongle
served over rtl_tcp). You have tools to control the receiver and inspect the RF spectrum.

Guidelines:
- Use the tools to actually observe the radio rather than guessing.
- `get_status` reports current tuning. `get_spectrum` reports the strongest signals.
- `tune` moves the receiver; `fine_tune` nudges it by a relative offset; `scan` sweeps a
  range; `characterize` analyzes one signal.
- `set_demod_mode` picks the demodulator (am/nbfm/wfm/usb/lsb); `set_bandwidth` sets the
  IF filter width in Hz; `set_gain` adjusts gain (dB or "auto"); `set_sample_rate` changes
  the SDR sample rate.
- `get_signal_metrics` returns quantitative measurements of the tuned signal (SNR, tuning
  error, bandwidth, modulation hint, adjacent interference).
- When a user asks to "find", "go to", or "tune to" a signal, use `scan` or `tune` as needed.
- When a user asks to "optimize", "improve", or "clean up" the signal, do this loop:
    1. call `get_signal_metrics`;
    2. apply corrections: `fine_tune(-tuning_error_hz)` to recenter, `set_bandwidth` to
       match the signal (narrow if adjacent_interference_db is high), `set_demod_mode` to
       match the modulation hint, `set_gain` if SNR is low or clipping is likely;
    3. call `get_signal_metrics` again to confirm the improvement;
    4. report what you changed and the before/after metrics.
- When identifying a signal, combine the measured bandwidth/frequency with the band label
  and your own knowledge of the radio spectrum to suggest likely signal types.
- Frequencies are in Hertz. Be concise and concrete; quote exact frequencies.

Reference band context (for interpretation):
""" + "\n".join(f"- {lo/1e6:.1f}–{hi/1e6:.1f} MHz: {label}" for lo, hi, label in dsp.BAND_PLAN)


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_status",
            "description": "Return current SDR status (center frequency, sample rate, gain).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tune",
            "description": "Tune the SDR center frequency.",
            "parameters": {
                "type": "object",
                "properties": {"freq_hz": {"type": "number", "description": "Frequency in Hz"}},
                "required": ["freq_hz"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_spectrum",
            "description": "Report the strongest signals currently in view (freq, power, bandwidth, hints).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scan",
            "description": "Sweep a frequency range and return detected signals. Restores tuning afterwards.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_hz": {"type": "number", "description": "Start frequency in Hz"},
                    "stop_hz": {"type": "number", "description": "Stop frequency in Hz"},
                    "step_hz": {"type": "number", "description": "Optional step in Hz"},
                },
                "required": ["start_hz", "stop_hz"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "characterize",
            "description": "Analyze a signal at a specific frequency (bandwidth, power, modulation hint, band).",
            "parameters": {
                "type": "object",
                "properties": {"freq_hz": {"type": "number", "description": "Frequency in Hz"}},
                "required": ["freq_hz"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_gain",
            "description": "Set receiver gain in dB (e.g. 20) or 'auto'.",
            "parameters": {
                "type": "object",
                "properties": {"gain": {"type": "string"}},
                "required": ["gain"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_demod_mode",
            "description": "Set the demodulation mode (am, nbfm, wfm, usb, lsb).",
            "parameters": {
                "type": "object",
                "properties": {"mode": {"type": "string", "enum": ["am", "nbfm", "wfm", "usb", "lsb"]}},
                "required": ["mode"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_bandwidth",
            "description": "Set the IF filter bandwidth in Hz (e.g. 12500 for NBFM, 2700 for SSB).",
            "parameters": {
                "type": "object",
                "properties": {"bandwidth_hz": {"type": "number", "description": "Bandwidth in Hz"}},
                "required": ["bandwidth_hz"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_sample_rate",
            "description": "Set the SDR sample rate in Hz (e.g. 2400000, 960000, 250000).",
            "parameters": {
                "type": "object",
                "properties": {"sample_rate": {"type": "number", "description": "Sample rate in Hz"}},
                "required": ["sample_rate"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fine_tune",
            "description": "Nudge the tuned frequency by a relative offset in Hz (positive = up).",
            "parameters": {
                "type": "object",
                "properties": {"offset_hz": {"type": "number", "description": "Offset in Hz"}},
                "required": ["offset_hz"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_signal_metrics",
            "description": "Return quantitative metrics for the tuned signal (SNR, tuning error, bandwidth, modulation hint, adjacent interference).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


def _execute_tool(name, args, radio):
    try:
        if name == "get_status":
            return radio.status()
        if name == "tune":
            return radio.tune(int(args["freq_hz"]))
        if name == "get_spectrum":
            return radio.spectrum_snapshot()
        if name == "scan":
            return radio.scan(int(args["start_hz"]), int(args["stop_hz"]), args.get("step_hz"))
        if name == "characterize":
            return radio.characterize(args.get("freq_hz"))
        if name == "set_gain":
            g = str(args.get("gain", "")).strip()
            gain = "auto" if g.lower() == "auto" else float(g)
            return radio.set_gain(gain)
        if name == "set_demod_mode":
            radio.set_audio_mode(args["mode"])
            return {"ok": True, "demod_mode": radio.audio_mode, "bandwidth_hz": radio.effective_bandwidth()}
        if name == "set_bandwidth":
            radio.set_audio_bandwidth(int(args["bandwidth_hz"]))
            return {"ok": True, "bandwidth_hz": radio.effective_bandwidth()}
        if name == "set_sample_rate":
            return radio.set_sample_rate(int(args["sample_rate"]))
        if name == "fine_tune":
            return radio.fine_tune(int(args["offset_hz"]))
        if name == "get_signal_metrics":
            return radio.get_signal_metrics()
        return {"error": f"unknown tool: {name}"}
    except Exception as e:  # noqa: BLE001
        return {"error": f"tool {name} failed: {e}"}


def _ollama_chat(messages):
    resp = requests.post(
        f"{config.OLLAMA_URL}/api/chat",
        json={
            "model": config.OLLAMA_MODEL,
            "messages": messages,
            "tools": TOOLS,
            "stream": False,
            "options": {"temperature": 0.2},
        },
        timeout=config.OLLAMA_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def chat(user_message, history, radio, max_tool_rounds=10):
    """Run one agent turn. history is a list of {role, content} dicts."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for h in history or []:
        role = h.get("role", "user")
        if role in ("user", "assistant", "tool"):
            messages.append({"role": role, "content": h.get("content", "")})
    messages.append({"role": "user", "content": user_message})

    tools_called = []
    for _ in range(max_tool_rounds):
        try:
            data = _ollama_chat(messages)
        except requests.RequestException as e:
            return {"reply": f"⚠️ Could not reach Ollama at {config.OLLAMA_URL}: {e}",
                    "tools_called": tools_called}

        msg = data.get("message", {})
        # Keep the assistant message (with any tool_calls) in history.
        messages.append({
            "role": "assistant",
            "content": msg.get("content", ""),
            "tool_calls": msg.get("tool_calls", []),
        })

        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            return {"reply": msg.get("content", ""), "tools_called": tools_called}

        for tc in tool_calls:
            fn = tc.get("function", {})
            name = fn.get("name")
            args = fn.get("arguments", {})
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {}
            tools_called.append(name)
            result = _execute_tool(name, args, radio)
            messages.append({"role": "tool", "content": json.dumps(result)})

    return {
        "reply": "I reached my tool-calling limit. Here is what I used so far: "
                 + ", ".join(tools_called),
        "tools_called": tools_called,
    }
