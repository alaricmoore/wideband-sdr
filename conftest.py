import os
import sys

# The backend modules use top-level imports (e.g. `import dsp`, `import config`),
# so put the backend/ directory on sys.path before tests are collected.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
