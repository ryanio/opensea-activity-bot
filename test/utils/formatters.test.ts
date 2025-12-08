import { GLYPHBOTS_CONTRACT_ADDRESS } from "../../src/utils/constants";
import {
  formatAmount,
  formatNftPrefix,
  imageForNFT,
} from "../../src/utils/utils";

describe("formatAmount", () => {
  test("rounds to 4 decimals", () => {
    expect(formatAmount("123456", 5, "ETH")).toBe("1.2346 ETH");
  });
  test("removes .0 for whole numbers", () => {
    expect(formatAmount("100000", 5, "ETH")).toBe("1 ETH");
  });
  test("rounds up seller net amount to match buyer gross amount", () => {
    // 0.0003 ETH sale with ~3% fees = seller gets 0.000291 ETH
    // Should round to 0.0003 to match what OpenSea UI displays
    expect(formatAmount("291000000000000", 18, "ETH")).toBe("0.0003 ETH");
  });
  test("handles exact amounts correctly", () => {
    expect(formatAmount("300000000000000", 18, "ETH")).toBe("0.0003 ETH");
    expect(formatAmount("200000000000000", 18, "ETH")).toBe("0.0002 ETH");
  });
  test("converts WETH to ETH for display", () => {
    expect(formatAmount("1000000000000000000", 18, "WETH")).toBe("1 ETH");
    expect(formatAmount("500000000000000000", 18, "WETH")).toBe("0.5 ETH");
    expect(formatAmount("1234567890000000000", 18, "WETH")).toBe("1.2346 ETH");
  });
});

describe("imageForNFT", () => {
  test("replaces width param with 10000", () => {
    expect(
      imageForNFT({ image_url: "https://img.example.com/foo?w=200&h=200" })
    ).toBe("https://img.example.com/foo?w=10000&h=200");
  });
  test("adds width param when no query params exist", () => {
    expect(imageForNFT({ image_url: "https://img.example.com/foo.png" })).toBe(
      "https://img.example.com/foo.png?w=10000"
    );
  });
  test("adds width param when other query params exist", () => {
    expect(
      imageForNFT({ image_url: "https://img.example.com/foo?h=200" })
    ).toBe("https://img.example.com/foo?h=200&w=10000");
  });
  test("returns undefined when missing", () => {
    expect(imageForNFT(undefined)).toBeUndefined();
  });
});

describe("formatNftPrefix", () => {
  const OLD_TOKEN = process.env.TOKEN_ADDRESS;
  beforeEach(() => {
    process.env.TOKEN_ADDRESS = GLYPHBOTS_CONTRACT_ADDRESS;
  });
  afterEach(() => {
    process.env.TOKEN_ADDRESS = OLD_TOKEN;
  });

  test("special contract uses name suffix and id", () => {
    const txt = formatNftPrefix({ name: "Prefix - Suffix", identifier: "42" });
    expect(txt).toBe("Suffix #42 ");
  });
  test("falls back to identifier when name missing", () => {
    const txt = formatNftPrefix({ identifier: "7" });
    expect(txt).toBe("#7 ");
  });
});
