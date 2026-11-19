import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, ".deps"))
sys.path.insert(0, os.path.join(ROOT, "src"))

# Headless rendering for all visualization-side checks.
os.environ.setdefault("MPLBACKEND", "Agg")
