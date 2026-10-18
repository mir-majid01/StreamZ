.PHONY: test

# Unit tests use the checked-in lockfile's installed dependencies only; no
# emulator, network service, or remote fixture is required.
test:
	npm run test:offline
