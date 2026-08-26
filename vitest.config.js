import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Fixture users are deactivated by each file's afterAll and hard-deleted
    // here, once, after every file has finished — deleting them while other
    // files are still running is what made the suite flaky (see
    // tests/helpers/users.js).
    globalSetup: ["./tests/globalSetup.js"],
    // Integration tests hit the live Neon database, with every test file
    // running against it concurrently by default — a cold-started compute
    // endpoint plus connection-pool contention across files (more of them
    // each phase) can occasionally push one test past a tight timeout, even
    // though it passes in well under half this budget in isolation.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
