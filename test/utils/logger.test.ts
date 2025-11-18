// Override global test setup to allow info logs for logger tests
process.env.LOG_LEVEL = "info";

import { prefixedLogger } from "../../src/utils/logger";

describe("prefixedLogger", () => {
  test("prefixes messages", () => {
    const log = prefixedLogger("Test");
    const spy = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    log.info("hello");
    const called = (spy.mock.calls[0]?.[0] as string) ?? "";
    expect(called.includes("[INFO]")).toBe(true);
    expect(called.includes("[Test]")).toBe(true);
    spy.mockRestore();
  });
});
