import { formatBdMsisdn, generateCsmsId } from "./phone";

describe("formatBdMsisdn", () => {
  it("formats local 01 number to 880", () => {
    expect(formatBdMsisdn("01712345678")).toBe("8801712345678");
  });

  it("keeps already formatted 880 number", () => {
    expect(formatBdMsisdn("8801712345678")).toBe("8801712345678");
  });

  it("strips non-digits", () => {
    expect(formatBdMsisdn("+880 1712-345678")).toBe("8801712345678");
  });
});

describe("generateCsmsId", () => {
  it("returns prefixed id", () => {
    expect(generateCsmsId("TST").startsWith("TST")).toBe(true);
  });
});
