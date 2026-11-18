CXX ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Wpedantic -Iinclude

BUILD_DIR := build

.PHONY: all test demo clean

all: test demo

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/probe_tests: tests/test_probe_system.cpp src/sampler.cpp \
		$(wildcard include/lp/*.h) tests/test_framework.h | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) -Itests tests/test_probe_system.cpp src/sampler.cpp \
		-o $@

$(BUILD_DIR)/two_room_demo: demo/two_room_demo.cpp src/sampler.cpp \
		$(wildcard include/lp/*.h) | $(BUILD_DIR)
	$(CXX) $(CXXFLAGS) demo/two_room_demo.cpp src/sampler.cpp -o $@

test: $(BUILD_DIR)/probe_tests
	./$(BUILD_DIR)/probe_tests

demo: $(BUILD_DIR)/two_room_demo
	./$(BUILD_DIR)/two_room_demo

clean:
	rm -rf $(BUILD_DIR)
