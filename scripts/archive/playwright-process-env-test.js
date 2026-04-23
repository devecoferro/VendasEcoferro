async () => ({
  has_process: typeof process !== "undefined",
  has_env: typeof process !== "undefined" && typeof process.env !== "undefined",
  test_value: typeof process !== "undefined" ? process.env.PLAYWRIGHT_ENV_TEST || null : null,
})
