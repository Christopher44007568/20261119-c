"""Bookkeeping for covariance and projection corrections."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class CorrectionLog:
    """Records every repair applied to a degenerate covariance.

    Each entry stores the point index, where the problem was detected
    (``"3d"`` or ``"2d"``), the reason code, the offending eigenvalues and
    the eigenvalues after repair.
    """

    point_index: list[int] = field(default_factory=list)
    stage: list[str] = field(default_factory=list)
    reason: list[str] = field(default_factory=list)
    eigenvalues_before: list[np.ndarray] = field(default_factory=list)
    eigenvalues_after: list[np.ndarray] = field(default_factory=list)

    def record(
        self,
        index: int,
        stage: str,
        reason: str,
        before: np.ndarray,
        after: np.ndarray,
    ) -> None:
        self.point_index.append(int(index))
        self.stage.append(stage)
        self.reason.append(reason)
        self.eigenvalues_before.append(np.asarray(before, dtype=float))
        self.eigenvalues_after.append(np.asarray(after, dtype=float))

    def __len__(self) -> int:
        return len(self.point_index)

    def summary(self) -> dict[str, int]:
        """Count of corrections keyed by ``stage:reason``."""
        counts: dict[str, int] = {}
        for stage, reason in zip(self.stage, self.reason):
            key = f"{stage}:{reason}"
            counts[key] = counts.get(key, 0) + 1
        return counts

    def to_array(self) -> np.ndarray:
        """Return recorded indices as an int array (empty if none)."""
        if not self.point_index:
            return np.empty(0, dtype=int)
        return np.asarray(self.point_index, dtype=int)
