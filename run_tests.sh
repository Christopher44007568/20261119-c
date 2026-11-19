#!/usr/bin/env bash
# 一键运行全部测试：Python 单元测试 + 查看器 JS 冒烟测试
set -euo pipefail
cd "$(dirname "$0")"

echo "== Python unittest =="
python3 -m unittest discover -s tests -v

echo
echo "== Viewer JS smoke =="
node tests/viewer_smoke.js

echo
echo "全部测试通过 ✓"
