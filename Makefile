CC ?= gcc
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Wpedantic
LDFLAGS ?= -l:libEGL.so.1 -ldl -lm

SOURCES = src/gl_api.c src/image.c src/render.c src/main.c
OBJECTS = $(SOURCES:src/%.c=build/%.o)

.PHONY: all check clean run

all: build/msaa_demo

build/msaa_demo: $(OBJECTS)
	$(CC) $(OBJECTS) -o $@ $(LDFLAGS)

build/%.o: src/%.c src/gl_api.h src/image.h src/render.h
	@mkdir -p build
	$(CC) $(CFLAGS) -c $< -o $@

run: build/msaa_demo
	@mkdir -p artifacts/results
	./build/msaa_demo 2>&1 | tee artifacts/results/run_log.txt

check: run
	python3 tests/validate_report.py

clean:
	rm -rf build
