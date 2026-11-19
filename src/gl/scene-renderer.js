export class SceneRenderer {
  constructor(gl) {
    this.gl = gl;
    this.uniformCache = new WeakMap();
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  _uniforms(program) {
    let uniforms = this.uniformCache.get(program);
    if (!uniforms) {
      uniforms = {
        uTime: this.gl.getUniformLocation(program, "uTime"),
        uResolution: this.gl.getUniformLocation(program, "uResolution"),
      };
      this.uniformCache.set(program, uniforms);
    }
    return uniforms;
  }

  draw(snapshot, seconds) {
    const { gl } = this;
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.008, 0.012, 0.024, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(this.vao);

    for (const bundle of snapshot.programs.values()) {
      const program = bundle.resource?.program;
      if (!program || !gl.isProgram(program)) continue;
      const overlay = /overlay/i.test(bundle.programId);
      if (overlay) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      } else {
        gl.disable(gl.BLEND);
      }

      gl.useProgram(program);
      const uniforms = this._uniforms(program);
      if (uniforms.uTime) gl.uniform1f(uniforms.uTime, seconds);
      if (uniforms.uResolution) gl.uniform2f(uniforms.uResolution, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }
}
