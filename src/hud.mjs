// HUD: controls + per-frame readouts for reflection resolution, extra draw
// time, reflection-coordinate error (perturb on/off) and clip direction.

export function createHud(el, state) {
  const controls = document.createElement('div');
  controls.innerHTML = `
    <label>反射分辨率
      <select id="hud-res">
        <option>256</option><option>512</option>
        <option selected>1024</option><option>2048</option>
      </select></label>
    <label><input type="checkbox" id="hud-perturb" checked> 法线扰动</label>
    <label><input type="checkbox" id="hud-clamp" checked> 采样钳制</label>
    <label><input type="checkbox" id="hud-debug" checked> 镜像相机/裁剪平面</label>
    <hr style="border-color:#2a3442">`;
  const readout = document.createElement('div');
  el.textContent = '';
  el.append(controls, readout);

  controls.querySelector('#hud-res').addEventListener('change', (e) => {
    const r = Number(e.target.value);
    state.reflRes = r;
    state.target.resize(state.gl, r, r);
  });
  controls.querySelector('#hud-perturb').addEventListener('change', (e) => {
    state.perturb = e.target.checked;
  });
  controls.querySelector('#hud-clamp').addEventListener('change', (e) => {
    state.clamp = e.target.checked;
  });
  controls.querySelector('#hud-debug').addEventListener('change', (e) => {
    state.debugView = e.target.checked;
  });

  const f = (v, d = 2) => (v == null ? 'n/a' : v.toFixed(d));

  function update() {
    if (!state.errOn) return;
    const t = state.timing;
    const cc = state.clipCheck;
    const res = state.target;
    const gpu = t.gpuMs == null && !state.timerExt ? 'n/a(无扩展)' : `${f(t.gpuMs)} ms`;
    const cross = cc.clippedPart && cc.keptPart;
    readout.innerHTML = [
      `<b>反射通道</b> ${res.width}×${res.height}`,
      `额外绘制耗时: CPU ${f(t.cpuMs)} ms / GPU ${gpu}`,
      ``,
      `<b>反射坐标误差</b> (相对平静水面 uv0, 像素)`,
      `  扰动开: mean ${f(state.errOn.mean)} / max ${f(state.errOn.max)}`,
      `  扰动关: mean ${f(state.errOff.mean)} / max ${f(state.errOff.max)}`,
      `  钳制命中 ${state.errOn.clampedCount} 次, 越界采样 ${
        state.errOn.outside === 0 ? '0 ✓' : `<span class="warn">${state.errOn.outside}</span>`}`,
      ``,
      `<b>裁剪方向</b> (移动球跨水面)`,
      `  球心到裁剪平面: ${f(cc.center)} m (半径 ${f(cc.radius)})`,
      `  ${cross ? '<span class="warn">正跨水面: 水上部分保留, 水下部分被斜裁剪</span>'
        : cc.keptPart ? '整体在水上: 全部进入反射' : '整体在水下: 反射中完全裁剪'}`,
      `  镜像相机在平面负侧: ${cc.mirrorSide}`,
      ``,
      `拖拽旋转视角, 滚轮升降相机`,
    ].join('\n');
  }

  return { update };
}
