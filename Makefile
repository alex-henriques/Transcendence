# Who knows best? (WKB), ft_transcendence
# `make` on a clean clone is the only command needed to bring the app up.

COMPOSE := docker compose
SHELL   := /bin/sh

# WEB_PORT is read from .env once it exists; 8443 is the documented default.
WEB_PORT ?= $(shell [ -f .env ] && sed -n 's/^WEB_PORT=//p' .env || echo 8443)

.DEFAULT_GOAL := all
.PHONY: all up down re logs ps seed certs env clean fclean psql shell-api cardgen \
        deps typecheck test e2e console-check a11y check help

## all: generate secrets + certificate, build the images, start the stack
all: env certs
	@echo "==> building and starting"
	@$(COMPOSE) up -d --build
	@echo ""
	@echo "  WKB is starting."
	@echo "  Open https://localhost:$(WEB_PORT)"
	@echo ""
	@echo "  The certificate is self-signed: Chrome shows a warning once."
	@echo "  Click 'Advanced' then 'Proceed to localhost (unsafe)'."
	@echo ""
	@echo "  Demo accounts (password  Password1! ):"
	@echo "    ada@wkb.local   grace@wkb.local   alan@wkb.local"
	@echo ""
	@echo "  Follow the boot with:  make logs"

## up: start without rebuilding
up: env certs
	@$(COMPOSE) up -d

## down: stop and remove the containers (data volumes are kept)
down:
	@$(COMPOSE) down

## re: full rebuild from scratch, discarding the database
re: fclean all

## logs: follow the logs of every service
logs:
	@$(COMPOSE) logs -f

## ps: show container status
ps:
	@$(COMPOSE) ps

## seed: re-run the idempotent seed (card set, achievements, bots, demo users)
seed:
	@$(COMPOSE) exec api node dist/seed/index.js

## certs: issue the self-signed TLS certificate
certs:
	@sh tools/scripts/gen-certs.sh

## env: create .env from .env.example with generated secrets
env:
	@sh tools/scripts/gen-env.sh

## psql: open a psql shell on the database
psql:
	@$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

## shell-api: open a shell inside the api container
shell-api:
	@$(COMPOSE) exec api sh

## cardgen: run the OpenTDB card pipeline (developer machine, see tools/cardgen)
cardgen:
	@sh tools/scripts/cardgen.sh $(ARGS)

## e2e: play a full match through the API and WebSocket, then check the results
e2e:
	@docker run --rm -v "$(PWD)":/w -w /w --user "$$(id -u):$$(id -g)" -e HOME=/tmp \
		--network wkb_wkb -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
		node:22-bookworm-slim node tools/scripts/e2e.mjs

## console-check: load every screen in headless Chrome and fail on any console output
console-check:
	@docker run --rm -v "$(PWD)":/w:ro --network wkb_wkb \
		-w /home/pptruser --entrypoint sh ghcr.io/puppeteer/puppeteer:latest \
		-c 'cp /w/tools/scripts/console-check.mjs ./check.mjs && node check.mjs'

## a11y: measure contrast, target size, overflow and history navigation
# Not part of `make test`: it loads a few hundred pages. The README's
# accessibility claims are this script's output.
a11y:
	@docker run --rm -v "$(PWD)":/w:ro --network wkb_wkb \
		-w /home/pptruser --entrypoint sh ghcr.io/puppeteer/puppeteer:latest \
		-c 'cp /w/tools/scripts/a11y-check.mjs ./a11y.mjs && node a11y.mjs'

## deps: install the workspace dependencies (only needed for typechecking)
# The application itself never needs this: its dependencies are installed
# inside the images. This is here so `make typecheck` works on a fresh clone.
deps:
	@if [ ! -d node_modules ]; then \
		echo "  installing workspace dependencies (first run only)"; \
		sh tools/scripts/node.sh npm ci --no-audit --no-fund >/dev/null; \
	fi

## typecheck: compile every workspace with no emit
typecheck: deps
	@sh tools/scripts/node.sh sh -c 'npm run build -w @wkb/shared >/dev/null 2>&1 \
		&& npx prisma generate --schema apps/api/prisma/schema.prisma >/dev/null 2>&1 \
		&& npx tsc -p apps/api/tsconfig.json --noEmit \
		&& npx tsc -b apps/web/tsconfig.json --force \
		&& npx tsc -p tools/cardgen/tsconfig.json --noEmit'
	@echo "  typecheck ok"

## test: typecheck every workspace, then run e2e and the console check
test:
	@$(MAKE) --no-print-directory typecheck
	@$(MAKE) --no-print-directory e2e
	@$(MAKE) --no-print-directory console-check

## check: validate the committed card set (balance, coverage, negation tell)
check: deps
	@sh tools/scripts/cardgen.sh check

## clean: stop containers and remove built images
clean:
	@$(COMPOSE) down --rmi local --remove-orphans

## fclean: clean + delete the database and uploaded avatars
fclean:
	@$(COMPOSE) down --rmi local --volumes --remove-orphans

## help: list the targets
help:
	@grep -E '^## ' Makefile | sed 's/^## /  /'
