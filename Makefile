.PHONY: build install

build:
	npm run build --prefix gitnexus

install: build
	npm link --prefix gitnexus
