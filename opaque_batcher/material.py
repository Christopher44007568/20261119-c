"""Stable material IDs.

A material ID is assigned once by the registry and is never reused or
reordered. Batching keys on this integer ID instead of object identity or
names, so editing a material property (for example its color) never forces
an instance to migrate between batches.
"""

from __future__ import annotations


class Material:
    __slots__ = ("material_id", "name", "color")

    def __init__(self, material_id: int, name: str,
                 color: tuple[float, float, float]):
        self.material_id = material_id
        self.name = name
        self.color = (float(color[0]), float(color[1]), float(color[2]))


class MaterialRegistry:
    """Owns materials and hands out monotonically increasing stable IDs."""

    def __init__(self) -> None:
        self._materials: dict[int, Material] = {}
        self._names: dict[str, int] = {}
        self._next_id = 1
        self._dirty: set[int] = set()

    def create(self, name: str, color: tuple[float, float, float]) -> int:
        if name in self._names:
            raise ValueError(f"material name already registered: {name}")
        material_id = self._next_id
        self._next_id += 1
        self._materials[material_id] = Material(material_id, name, color)
        self._names[name] = material_id
        self._dirty.add(material_id)
        return material_id

    def get(self, material_id: int) -> Material:
        return self._materials[material_id]

    def find(self, name: str) -> int:
        return self._names[name]

    def set_color(self, material_id: int,
                  color: tuple[float, float, float]) -> None:
        """Modify a material property in place.

        The stable ID is unchanged, so batch membership is unaffected. Only
        the material constant slot is marked for re-upload.
        """
        material = self._materials[material_id]
        material.color = (float(color[0]), float(color[1]), float(color[2]))
        self._dirty.add(material_id)

    def ids(self) -> list[int]:
        return list(self._materials.keys())

    def take_dirty(self) -> set[int]:
        """Return and clear the set of material IDs needing constant upload."""
        dirty = self._dirty
        self._dirty = set()
        return dirty

    def mark_dirty(self, material_id: int) -> None:
        self._dirty.add(material_id)
