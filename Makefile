CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic

SRC := src/mesh.cpp src/normalmap.cpp src/image.cpp src/renderer.cpp

.PHONY: all test viewer-test mesh-data clean

all: build/tangent_tests

build:
	mkdir -p build artifacts

build/tangent_tests: $(SRC) src/tests.cpp | build
	$(CXX) $(CXXFLAGS) $(SRC) src/tests.cpp -o $@

build/export_mesh: $(SRC) src/export_mesh.cpp | build
	$(CXX) $(CXXFLAGS) $(SRC) src/export_mesh.cpp -o $@

mesh-data: build/export_mesh
	mkdir -p viewer
	./build/export_mesh viewer/mesh_data.js

test: build/tangent_tests
	./build/tangent_tests

viewer-test: mesh-data
	node viewer/headless_test.js

all-tests: test viewer-test

clean:
	rm -rf build artifacts/*.ppm artifacts/test_report.txt
