import { fetchNFT } from "../../src/opensea";

// Mock the fetch function
global.fetch = jest.fn();

describe("fetchNFT", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should fetch NFT metadata successfully", async () => {
    const mockNFT = {
      identifier: "3333",
      collection: "glyphbots",
      contract: "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075",
      token_standard: "erc721",
      name: "GlyphBot #3333 - Glitchyflux",
      description:
        "Onchain text robots assembled from Unicode glyphs. Deterministic per tokenId.",
      image_url:
        "https://raw2.seadn.io/ethereum/0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075/3c2e726f9eea0a2d6ffe83b93fde24/383c2e726f9eea0a2d6ffe83b93fde24.svg",
      display_image_url:
        "https://raw2.seadn.io/ethereum/0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075/3c2e726f9eea0a2d6ffe83b93fde24/383c2e726f9eea0a2d6ffe83b93fde24.svg",
      display_animation_url: null,
      metadata_url: null,
      opensea_url:
        "https://opensea.io/assets/ethereum/0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075/3333",
      updated_at: "2025-08-30T06:24:07.571597",
      is_disabled: false,
      is_nsfw: false,
      animation_url: null,
      is_suspicious: false,
      creator: "",
      traits: [],
      owners: [],
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nft: mockNFT }),
    });

    const result = await fetchNFT("3333");

    expect(result).toEqual(mockNFT);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should return undefined when API request fails", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "Not Found",
    });

    const result = await fetchNFT("9999");

    expect(result).toBeUndefined();
  });

  it("should handle numeric and string token IDs", async () => {
    const mockNFT = {
      identifier: "123",
      name: "Test NFT",
      image_url: "https://example.com/image.png",
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nft: mockNFT }),
    });

    await fetchNFT(123);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ nft: mockNFT }),
    });

    await fetchNFT("123");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
