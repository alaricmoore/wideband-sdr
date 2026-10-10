# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-09

### Added

- Live spectrum + waterfall with peak labels, click-to-tune, and a dB color legend.
- AM / NBFM / WFM / USB / LSB audio demodulation with bandwidth, de-emphasis, and tone controls.
- Ollama-powered AI assistant with tool-calling (`tune`, `scan`, `characterize`, `optimize`, etc.).
- Live signal inspector (SNR, tuning error, bandwidth, adjacent interference).
- Band-context indicator and activity log.
- Native rtl_tcp wire-protocol client (no `pyrtlsdr` dependency).
- Docker and docker-compose setup.
- Test suite covering DSP, demodulators, rtl_tcp protocol, and AI tool dispatch.

[0.1.0]: https://github.com/OWNER/REPO/releases/tag/v0.1.0
