# ═══════════════════════════════════════════════════════
# FabcConnect Laser Time Calculator — Makefile
# ═══════════════════════════════════════════════════════

PORT     := 8080
DIST     := dist
SRC      := .

.PHONY: all help serve serve-node build clean zip

all: help

help:
	@echo ""
	@echo "  FabcConnect Laser Time Calculator"
	@echo "  ══════════════════════════════════"
	@echo "  make serve       Python dev server (port $(PORT))"
	@echo "  make serve-node  Node.js dev server (port $(PORT))"
	@echo "  make build       Build to dist/"
	@echo "  make clean       Remove dist/"
	@echo "  make zip         Create release zip"
	@echo ""

serve:
	@echo "▶ http://localhost:$(PORT)"
	@python3 -m http.server $(PORT) --directory $(SRC)

serve-node:
	@echo "▶ http://localhost:$(PORT)"
	@npx --yes serve $(SRC) -l $(PORT)

build: clean
	@mkdir -p $(DIST)/js/modules $(DIST)/css
	@cp index.html README.md $(DIST)/
	@cp css/style.css $(DIST)/css/
	@cp js/app.js $(DIST)/js/
	@cp js/modules/*.js $(DIST)/js/modules/
	@echo "✓ Built → $(DIST)/"

clean:
	@rm -rf $(DIST)
	@echo "✓ Cleaned."

zip: build
	@cd $(DIST) && zip -r ../fabcconnect-laser-time.zip . -x "*.DS_Store"
	@echo "✓ fabcconnect-laser-time.zip ready."
