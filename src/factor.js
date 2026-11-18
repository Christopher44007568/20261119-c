export const now = () => (
  typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now()
);

export class DenseCholesky {
  constructor(matrix, size) {
    this.size = size;
    this.lower = new Float64Array(matrix);
    this.label = "";
  }

  factor() {
    const size = this.size;
    const lower = this.lower;
    const started = now();
    for (let row = 0; row < size; row += 1) {
      const rowOffset = row * size;
      for (let column = 0; column <= row; column += 1) {
        const columnOffset = column * size;
        let value = lower[rowOffset + column];
        for (let inner = 0; inner < column; inner += 1) {
          value -= lower[rowOffset + inner] * lower[columnOffset + inner];
        }
        if (row === column) {
          if (value <= 1e-12) {
            throw new Error(`矩阵在 (${row}, ${column}) 处不是正定的：${value}`);
          }
          lower[rowOffset + column] = Math.sqrt(value);
        } else {
          lower[rowOffset + column] = value / lower[columnOffset + column];
        }
      }
    }
    this.factorMs = now() - started;
    return this;
  }

  solve(rhs) {
    const size = this.size;
    const lower = this.lower;
    const intermediate = new Float64Array(size);
    const solution = new Float64Array(size);
    for (let row = 0; row < size; row += 1) {
      const rowOffset = row * size;
      let value = rhs[row];
      for (let column = 0; column < row; column += 1) {
        value -= lower[rowOffset + column] * intermediate[column];
      }
      intermediate[row] = value / lower[rowOffset + row];
    }
    for (let row = size - 1; row >= 0; row -= 1) {
      let value = intermediate[row];
      for (let column = row + 1; column < size; column += 1) {
        value -= lower[column * size + row] * solution[column];
      }
      solution[row] = value / lower[row * size + row];
    }
    return solution;
  }
}

export function emptyMatrix(size) {
  return new Float64Array(size * size);
}
