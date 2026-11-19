"""CSV / JSON reporting of streamline lengths and break positions."""

from __future__ import annotations

import csv
import json

import numpy as np


def write_length_csv(path, lines):
    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["line_id", "layer", "arc_length", "segments"])
        for line in lines:
            writer.writerow([
                line.line_id, line.layer,
                f"{line.arc_length:.6f}", len(line.points) - 1,
            ])


def write_breaks_csv(path, breaks):
    with open(path, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["line_id", "layer", "reason", "face", "x", "y", "z"])
        for record in breaks:
            xyz = record["xyz"]
            writer.writerow([
                record["line_id"], record["layer"], record["reason"],
                record["face"],
                f"{xyz[0]:.6f}", f"{xyz[1]:.6f}", f"{xyz[2]:.6f}",
            ])


def write_summary_json(path, summary):
    def default(obj):
        if isinstance(obj, (np.floating, np.integer)):
            return obj.item()
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        raise TypeError(f"not serializable: {type(obj)!r}")
    with open(path, "w") as fh:
        json.dump(summary, fh, indent=2, default=default, allow_nan=True)
        fh.write("\n")
