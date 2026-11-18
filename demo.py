"""演示：贪心网格化、局部删除重建、面数变化与参照对比。

运行：python3 demo.py
"""

from voxelmesh import World


def show(title, world):
    metrics = world.metrics()
    counts = world.counts()
    report = world.verify_against_naive()
    print(f"\n== {title} ==")
    print(
        f"贪心矩形面={counts.quad_count}  单位面={counts.unit_count}  "
        f"外表面积={metrics['external']}  材质分界={metrics['boundary']}"
    )
    print(
        f"逐体素参照单位面={report['reference_unit_faces']}  "
        f"一致={report['matches']}  重复内部面={report['duplicate_internal_faces']}"
    )


def main():
    world = World(chunk_size=(4, 4, 4))
    # 跨两个分块的双色场景，块边界位于 x=4。
    world.fill_box((0, 0, 0), (4, 4, 4), material=1)
    world.fill_box((4, 0, 0), (8, 4, 4), material=2)
    world.rebuild_all()
    show("初始双色场景（2 个分块）", world)

    print("\n-- 局部删除序列 --")
    for position in ((1, 1, 1), (3, 0, 0), (4, 0, 0), (7, 3, 3)):
        result = world.delete_voxel(*position)
        print(result.summary())
        report = world.verify_against_naive()
        assert report["matches"], report

    show("删除 4 个体素后", world)
    print("\n所有状态下贪心网格均与逐体素参照完全一致，无重复内部面。")


if __name__ == "__main__":
    main()
