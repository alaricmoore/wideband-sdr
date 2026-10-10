# Contributing

Thanks for your interest in contributing to Wideband-SDR!

## Development setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
```

No SDR hardware is required to work on the code — the test suite uses an
in-process mock rtl_tcp server.

## Running the tests

```bash
pytest
```

The suite (`tests/`) covers the DSP (FFT / peak detection / signal metrics), the
demodulators (synthetic AM/FM/SSB tones, bandwidth filtering, de-emphasis, soft
limiter, tone tilt), the rtl_tcp wire protocol (mock server), and the AI tool
dispatch.

## Code style

- **Python**: follow PEP 8; keep modules small and well-documented.
- **JavaScript**: plain ES2015+ with no build step or framework.

## Submitting changes

1. Fork the repository and create a feature branch.
2. Make your changes, adding or updating tests where appropriate.
3. Run `pytest` and confirm everything passes.
4. Open a pull request with a clear description of what changed and why.

## Reporting issues

Open an issue with:

- what you were trying to do,
- what you expected to happen,
- what actually happened (including any error output),
- your environment (SDR model, rtl_tcp version, Ollama model, browser).
