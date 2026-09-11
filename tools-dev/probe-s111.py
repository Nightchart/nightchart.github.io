# -*- coding: utf-8 -*-
# 拆解 S-111 样本，给文章取真实数据
import h5py, numpy as np

f = h5py.File("assets/h5wasm/sample-s111.h5", "r")

def walk(name, obj):
    kind = "G" if isinstance(obj, h5py.Group) else "D"
    print(f"[{kind}] {name}", obj.shape if kind == "D" else f"({len(obj)} items)")

print("=== 结构 ===")
f.visititems(walk)

print("\n=== 根属性 ===")
for k, v in f.attrs.items():
    val = v.decode() if isinstance(v, bytes) else v
    s = str(val)
    print(f"  {k} = {s[:120]}")

def find_current_group(f):
    for name, obj in f.items():
        pass
    # 常见路径 SurfaceCurrent/Current.01 或类似
    for key in ["SurfaceCurrent"]:
        if key in f:
            return f[key]
    return None

sc = None
for k in f.keys():
    print("root child:", k)

# 递归找所有带 speed/direction 的组
print("\n=== 找流场数据组 ===")
groups_with_speed = []
def find_speed(name, obj):
    if isinstance(obj, h5py.Group) and "speed" in obj:
        groups_with_speed.append(name)
f.visititems(find_speed)
print("含 speed 的组数:", len(groups_with_speed))
if groups_with_speed:
    print("前5个:", groups_with_speed[:5])
    g = f[groups_with_speed[0]]
    print("\n=== 单帧组属性 ===")
    for k, v in g.attrs.items():
        val = v.decode() if isinstance(v, bytes) else v
        print(f"  {k} = {str(val)[:150]}")
    sp = g["speed"][:]
    dr = g["direction"][:] if "direction" in g else None
    print("\nspeed dtype:", sp.dtype, "shape:", sp.shape)
    print("direction dtype:", dr.dtype if dr is not None else "-", "shape:", dr.shape if dr is not None else "-")
    print("speed  min/max:", float(np.nanmin(sp)), "/", float(np.nanmax(sp)))
    if dr is not None:
        print("dir    min/max:", float(np.nanmin(dr)), "/", float(np.nanmax(dr)))
    print("speed 唯一值(前10):", np.unique(sp)[:10])
    neg = np.unique(sp[sp < 0])
    print("负值(疑似填充):", neg[:5])
    # 方向分布直方
    if dr is not None:
        hist, edges = np.histogram(dr[dr >= 0], bins=8, range=(0, 360))
        print("方向分布(8扇区):", hist.tolist())

print("\n=== 第一个数据组的关键属性（uom/fillValue）===")
if groups_with_speed:
    g = f[groups_with_speed[0]]
    for name in ["speed", "direction"]:
        if name in g:
            d = g[name]
            print(f"  {name} attrs:", {k: (v.decode() if isinstance(v, bytes) else v) for k, v in d.attrs.items()})

f.close()
