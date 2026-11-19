"""Opaque scene graph: instances plus stable per-object pick IDs."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Instance:
    """One opaque object instance.

    pick_id is a stable, unique 1-based per-object identifier written into
    the pick render target, independent of which draw batch the instance
    lands in.
    """

    pick_id: int
    mesh_name: str
    material_id: int
    position: tuple[float, float, float]
    scale: float = 1.0
    visible: bool = True


class Scene:
    def __init__(self) -> None:
        self._instances: dict[int, Instance] = {}
        self._next_pick_id = 1

    def add(self, mesh_name: str, material_id: int,
            position: tuple[float, float, float],
            scale: float = 1.0) -> Instance:
        pick_id = self._next_pick_id
        self._next_pick_id += 1
        instance = Instance(pick_id, mesh_name, material_id,
                            tuple(position), float(scale))
        self._instances[pick_id] = instance
        return instance

    def get(self, pick_id: int) -> Instance:
        return self._instances[pick_id]

    def remove(self, pick_id: int) -> None:
        del self._instances[pick_id]

    def set_material(self, pick_id: int, material_id: int) -> None:
        """Local material replacement for a single object."""
        self._instances[pick_id].material_id = material_id

    def visible_instances(self) -> list[Instance]:
        return [inst for inst in self._instances.values() if inst.visible]

    def all_instances(self) -> list[Instance]:
        return list(self._instances.values())
