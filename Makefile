PLUGIN := planeai-plugin-claude-headless
DIST := dist/$(PLUGIN)
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)

ifeq ($(OS),Windows_NT)
  PLATFORM := windows-x64
  BUN_TARGET := bun-windows-x64
  BINARY := $(PLUGIN).exe
else ifeq ($(UNAME_S),Darwin)
  ifeq ($(UNAME_M),arm64)
    PLATFORM := macos-arm64
    BUN_TARGET := bun-darwin-arm64
  else
    PLATFORM := unsupported-macos
  endif
else ifeq ($(UNAME_S),Linux)
  PLATFORM := linux-x64
  BUN_TARGET := bun-linux-x64
endif
BINARY ?= $(PLUGIN)

.PHONY: build-ui build-sidecar check test package verify-package conformance clean

build-ui:
	pnpm exec vite build

build-sidecar:
	@case "$(PLATFORM)" in unsupported*|"") echo "Unsupported packaging platform; Apple Silicon, linux-x64 and windows-x64 are supported" >&2; exit 2;; esac
	bun build --compile --minify --target=$(BUN_TARGET) src/main.ts --outfile build/bin/$(BINARY)

check:
	pnpm exec tsc
	pnpm exec svelte-check --fail-on-warnings

test: check
	pnpm exec vitest run

package: build-ui build-sidecar
	rm -rf $(DIST)
	mkdir -p $(DIST)/bin/$(PLATFORM) $(DIST)/ui
	node scripts/stage-manifest.mjs $(PLATFORM) > $(DIST)/planeai-plugin.json
	cp build/ui/chat.js $(DIST)/ui/chat.js
	cp build/bin/$(BINARY) $(DIST)/bin/$(PLATFORM)/$(BINARY)
	chmod +x $(DIST)/bin/$(PLATFORM)/$(BINARY)
	@echo "Staged $(DIST) for $(PLATFORM)"

verify-package: package
	node scripts/verify-package-handshake.mjs $(DIST) $(PLATFORM)

# Full host contract checks, offline: PLANEAI_CLI points at a planeai-cli build of the host.
conformance: package
	$(PLANEAI_CLI) plugin test --package $(DIST)

clean:
	rm -rf build dist
