.PHONY: build install

build:
	npm run build

install: build
	npm link
