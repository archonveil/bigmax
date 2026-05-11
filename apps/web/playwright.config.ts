import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["E2E_PORT"] ?? 3030);
const BASE_URL = process.env["E2E_BASE_URL"] ?? `http://localhost:${PORT}`;
const MOCK_PORT = Number(process.env["E2E_MOCK_PORT"] ?? 8787);
const MOCK_URL = process.env["E2E_MOCK_URL"] ?? `http://localhost:${MOCK_PORT}`;

// Если E2E_BASE_URL задан извне — подразумеваем, что web и mock уже подняты.
// Иначе playwright поднимает оба сам через webServer-array (P4-T12).
const externalServers = !!process.env["E2E_BASE_URL"];

export default defineConfig({
  testDir: "./e2e",
  // БД и Redis — общий ресурс, избегаем гонок между тестами.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
  ],
  webServer: externalServers
    ? undefined
    : [
        {
          // UNITELLER_BASE_URL=MOCK_URL переадресует все server-side
          // outbound-вызовы (cancelUnitellerPayment, fetchPaymentStatus)
          // на mock-server'е, чтобы admin-refund/recheck e2e работали без
          // выхода в Uniteller (P6-T6 follow-up + master-prompt §5.11).
          command: `PORT=${PORT} UNITELLER_BASE_URL=${MOCK_URL} pnpm dev`,
          url: BASE_URL,
          reuseExistingServer: !process.env["CI"],
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          // P4-T12 mock: callback идёт обратно на dev-web по BASE_URL.
          // MOCK_PASSWORD должен совпадать с UNITELLER_PASSWORD приложения,
          // иначе верификация Signature на /pay/ упадёт.
          command: `MOCK_PORT=${MOCK_PORT} MOCK_WEBHOOK_BASE=${BASE_URL} pnpm --filter @bigmax/payments mock:dev`,
          url: `${MOCK_URL}/health`,
          reuseExistingServer: !process.env["CI"],
          timeout: 30_000,
          stdout: "pipe",
          stderr: "pipe",
        },
      ],
});
