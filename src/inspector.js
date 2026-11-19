const CAPTURE_WIDTH = 192;
const CAPTURE_HEIGHT = 120;

function formatNumber(value) {
  if (Math.abs(value) < 0.005) return "0.00";
  return value.toFixed(2);
}

function matrixRows(matrix) {
  const elements = matrix.elements;
  return [
    [elements[0], elements[4], elements[8], elements[12]],
    [elements[1], elements[5], elements[9], elements[13]],
    [elements[2], elements[6], elements[10], elements[14]],
    [elements[3], elements[7], elements[11], elements[15]],
  ];
}

export class RecursionInspector {
  constructor(renderer, portalRenderer) {
    this.renderer = portalRenderer;
    this.stack = document.querySelector("#stack");
    this.depthBadge = document.querySelector("#depth-badge");
    this.depthOutput = document.querySelector("#depth-output");
    this.observerMetric = document.querySelector("#observer-metric");
    this.pairMetric = document.querySelector("#pair-metric");
    this.maskTotal = document.querySelector("#mask-total");
    this.rows = [];
    this.cap = -1;
  }

  rebuild(chain, cap) {
    if (this.cap === cap) return;
    this.cap = cap;
    this.rows = [];
    this.stack.replaceChildren();
    this.depthBadge.textContent = String(cap).padStart(2, "0");
    this.depthOutput.textContent = String(cap).padStart(2, "0");

    for (let index = 0; index <= cap; index += 1) {
      const terminal = index === cap;
      const row = document.createElement("article");
      row.className = `layer${terminal ? " terminal" : ""}`;
      row.dataset.layer = String(index);

      const preview = document.createElement("div");
      preview.className = "layer-preview";
      const canvas = document.createElement("canvas");
      canvas.width = CAPTURE_WIDTH;
      canvas.height = CAPTURE_HEIGHT;
      const tag = document.createElement("em");
      tag.textContent = terminal ? "TERM" : `REF ${index}`;
      preview.append(canvas, tag);

      const reference = document.createElement("span");
      reference.className = "layer-ref";
      reference.textContent = `REF ${String(index).padStart(2, "0")}`;

      const main = document.createElement("div");
      main.className = "layer-main";
      const title = document.createElement("div");
      title.className = "layer-title";
      const name = document.createElement("strong");
      const room = document.createElement("span");
      title.append(name, room);

      const matrix = document.createElement("div");
      matrix.className = "matrix";
      const cells = [];
      for (let cell = 0; cell < 16; cell += 1) {
        const span = document.createElement("span");
        matrix.append(span);
        cells.push(span);
      }
      const pose = document.createElement("div");
      pose.className = "pose-line";
      main.append(title, matrix, pose);

      const pixels = document.createElement("div");
      pixels.className = "layer-px";
      row.append(preview, reference, main, pixels);
      this.stack.append(row);
      this.rows.push({ row, canvas, name, room, cells, pose, pixels });
    }
    this.updateChain(chain);
  }

  updateChain(chain) {
    if (!chain || !chain.cameras.length) return;
    this.rows.forEach((row, index) => {
      const camera = chain.cameras[index];
      const portal = chain.portals[index];
      if (!camera || !portal) return;
      const terminal = index === this.cap;
      row.name.textContent = index === 0
        ? "LIVE / BASE"
        : terminal
          ? `TERM / CAP ${String(this.cap).padStart(2, "0")}`
          : `LAYER / ${String(index).padStart(2, "0")}`;
      row.room.textContent = `ROOM ${portal.room} · REF ${index}`;
      const values = matrixRows(camera.matrixWorld).flat();
      row.cells.forEach((cell, cellIndex) => {
        cell.textContent = formatNumber(values[cellIndex]);
      });
      const position = camera.position;
      row.pose.textContent = `POS ${position.x.toFixed(2)} ${position.y.toFixed(2)} ${position.z.toFixed(2)}`;
    });
  }

  applyCaptures(captures) {
    let total = 0;
    captures.forEach((capture, index) => {
      const row = this.rows[index];
      if (!row) return;
      const context = row.canvas.getContext("2d");
      context.putImageData(capture.imageData, 0, 0);
      const percent = (capture.count / (CAPTURE_WIDTH * CAPTURE_HEIGHT)) * 100;
      row.pixels.textContent = `${capture.count} PX / ${percent.toFixed(0)}%`;
      total += capture.count;
    });
    this.maskTotal.textContent = `${total} PX`;
  }

  setRoom(room, portal, camera) {
    const roomElement = document.querySelector("#observer-room");
    const poseElement = document.querySelector("#camera-pose");
    roomElement.textContent = `ROOM ${room}`;
    roomElement.style.color = room === "A" ? "var(--room-a)" : "var(--room-b)";
    this.observerMetric.textContent = `ROOM ${room}`;
    this.pairMetric.textContent = portal
      ? `${portal.id} → ${portal.partner.id} · Y 180°`
      : "NO LINK";
    poseElement.textContent = `POS ${camera.position.x.toFixed(2)} ${camera.position.y.toFixed(2)} ${camera.position.z.toFixed(2)}`;
  }
}

