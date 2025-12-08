import collectionFixture from "../fixtures/opensea/get-collection.json";

// Mock the fetch function
global.fetch = jest.fn();

jest.mock("../../src/utils/logger", () => {
  const base = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  return {
    logger: base,
    prefixedLogger: () => base,
  };
});

describe("fetchCollection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the module cache to reset LRU cache
    jest.resetModules();
  });

  it("should fetch collection data successfully", async () => {
    // Re-import to get fresh cache
    const { fetchCollection: freshFetchCollection } = await import(
      "../../src/opensea"
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => collectionFixture,
    });

    const result = await freshFetchCollection("glyphbots");

    expect(result).toEqual(collectionFixture);
    expect(result?.image_url).toBe(
      "https://i2c.seadn.io/collection/glyphbots/image_type_logo/eb2761fda8e04533a74e6477a35ab0/20eb2761fda8e04533a74e6477a35ab0.png"
    );
    expect(result?.collection).toBe("glyphbots");
    expect(result?.name).toBe("GlyphBots");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.opensea.io/api/v2/collections/glyphbots",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      })
    );
  });

  it("should cache collection data and return cached result on second call", async () => {
    // Re-import to get fresh cache
    const { fetchCollection: freshFetchCollection } = await import(
      "../../src/opensea"
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => collectionFixture,
    });

    const firstResult = await freshFetchCollection("glyphbots");
    expect(firstResult).toEqual(collectionFixture);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const secondResult = await freshFetchCollection("glyphbots");
    expect(secondResult).toEqual(collectionFixture);
    // Fetch should still only be called once due to caching
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should return undefined when API request fails", async () => {
    // Re-import to get fresh cache
    const { fetchCollection: freshFetchCollection } = await import(
      "../../src/opensea"
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "Not Found",
    });

    const result = await freshFetchCollection("nonexistent");

    expect(result).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should handle fetch errors gracefully", async () => {
    // Re-import to get fresh cache
    const { fetchCollection: freshFetchCollection } = await import(
      "../../src/opensea"
    );

    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network error")
    );

    const result = await freshFetchCollection("glyphbots");

    expect(result).toBeUndefined();
  });

  it("should include image_url field for Discord embeds", async () => {
    // Re-import to get fresh cache
    const { fetchCollection: freshFetchCollection } = await import(
      "../../src/opensea"
    );

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => collectionFixture,
    });

    const result = await freshFetchCollection("glyphbots");

    expect(result?.image_url).toBeDefined();
    expect(typeof result?.image_url).toBe("string");
    expect(result?.image_url).toContain("seadn.io");
  });
});
