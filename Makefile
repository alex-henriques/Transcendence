COMPOSE := docker compose
SHELL   := /bin/sh
WEB_PORT ?= $(shell [ -f .env ] && sed -n 's/^WEB_PORT=//p' .env || echo 8443)

.DEFAULT_GOAL := all
.PHONY: all up down re logs ps seed certs env clean fclean psql shell-api cardgen \
        deps typecheck test e2e console-check a11y check help

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

up: env certs
	@$(COMPOSE) up -d

down:
	@$(COMPOSE) down

re: fclean all

logs:
	@$(COMPOSE) logs -f

ps:
	@$(COMPOSE) ps

seed:
	@$(COMPOSE) exec api node dist/seed/index.js

certs:
	@sh tools/scripts/gen-certs.sh

env:
	@sh tools/scripts/gen-env.sh

psql:
	@$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

shell-api:
	@$(COMPOSE) exec api sh

cardgen:
	@sh tools/scripts/cardgen.sh $(ARGS)

e2e:
	@docker run --rm -v "$(PWD)":/w -w /w --user "$$(id -u):$$(id -g)" -e HOME=/tmp \
		--network wkb_wkb -e NODE_TLS_REJECT_UNAUTHORIZED=0 \
		node:22-bookworm-slim node tools/scripts/e2e.mjs

console-check:
	@docker run --rm -v "$(PWD)":/w:ro --network wkb_wkb \
		-w /home/pptruser --entrypoint sh ghcr.io/puppeteer/puppeteer:latest \
		-c 'cp /w/tools/scripts/console-check.mjs ./check.mjs && node check.mjs'

a11y:
	@docker run --rm -v "$(PWD)":/w:ro --network wkb_wkb \
		-w /home/pptruser --entrypoint sh ghcr.io/puppeteer/puppeteer:latest \
		-c 'cp /w/tools/scripts/a11y-check.mjs ./a11y.mjs && node a11y.mjs'

deps:
	@if [ ! -d node_modules ]; then \
		echo "  installing workspace dependencies (first run only)"; \
		sh tools/scripts/node.sh npm ci --no-audit --no-fund >/dev/null; \
	fi

typecheck: deps
	@sh tools/scripts/node.sh sh -c 'npm run build -w @wkb/shared >/dev/null 2>&1 \
		&& npx prisma generate --schema apps/api/prisma/schema.prisma >/dev/null 2>&1 \
		&& npx tsc -p apps/api/tsconfig.json --noEmit \
		&& npx tsc -b apps/web/tsconfig.json --force \
		&& npx tsc -p tools/cardgen/tsconfig.json --noEmit'
	@echo "  typecheck ok"

test:
	@$(MAKE) --no-print-directory typecheck
	@$(MAKE) --no-print-directory e2e
	@$(MAKE) --no-print-directory console-check

check: deps
	@sh tools/scripts/cardgen.sh check

clean:
	@$(COMPOSE) down --rmi local --remove-orphans

fclean:
	@$(COMPOSE) down --rmi local --volumes --remove-orphans

help:
	@grep -E '^## ' Makefile | sed 's/^## /  /'
