import { fetchImageBuffer } from "../src/utils/utils";

// Mock fetch to return AVIF content
global.fetch = jest.fn();

// Mock sharp
jest.mock("sharp", () => {
  const mockSharp = jest.fn().mockImplementation(() => {
    return {
      png: jest.fn().mockReturnThis(),
      toBuffer: jest.fn().mockResolvedValue(
        Buffer.from([
          0x89,
          0x50,
          0x4e,
          0x47,
          0x0d,
          0x0a,
          0x1a,
          0x0a, // PNG signature
        ])
      ),
    };
  });
  return mockSharp;
});

// Create a mock AVIF buffer
const createMockAvifBuffer = () => {
  const buffer = Buffer.alloc(100);
  buffer.write("....ftypavif", 0); // Simplified AVIF marker
  return buffer;
};

describe("AVIF to PNG Conversion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should convert AVIF to PNG when content-type is image/avif", async () => {
    const mockAvifBuffer = createMockAvifBuffer();

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockAvifBuffer.buffer),
      headers: {
        get: (header: string) => {
          if (header === "content-type") {
            return "image/avif";
          }
          return null;
        },
      },
    });

    const result = await fetchImageBuffer(
      "https://i2.seadn.io/ethereum/0x7136496abfbab3d17c34a3cfc4cfbc68bfbccbcc/40f196698abaf81f2e7fb1f458d365/1b40f196698abaf81f2e7fb1f458d365.png?w=10000"
    );

    expect(result.mimeType).toBe("image/png");
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith(
      "https://i2.seadn.io/ethereum/0x7136496abfbab3d17c34a3cfc4cfbc68bfbccbcc/40f196698abaf81f2e7fb1f458d365/1b40f196698abaf81f2e7fb1f458d365.png?w=10000"
    );
  });

  it("should handle AVIF conversion even when URL ends with .png", async () => {
    const mockAvifBuffer = createMockAvifBuffer();

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockAvifBuffer.buffer),
      headers: {
        get: (header: string) => {
          if (header === "content-type") {
            return "image/avif"; // Server returns AVIF despite .png extension
          }
          return null;
        },
      },
    });

    const result = await fetchImageBuffer("https://example.com/image.png");

    expect(result.mimeType).toBe("image/png");
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("should not modify actual PNG files", async () => {
    // PNG file header signature
    const PNG_SIGNATURE_BYTE_1 = 0x89;
    const PNG_SIGNATURE_BYTE_2 = 0x50;
    const PNG_SIGNATURE_BYTE_3 = 0x4e;
    const PNG_SIGNATURE_BYTE_4 = 0x47;
    const pngBuffer = Buffer.from([
      PNG_SIGNATURE_BYTE_1,
      PNG_SIGNATURE_BYTE_2,
      PNG_SIGNATURE_BYTE_3,
      PNG_SIGNATURE_BYTE_4,
    ]);

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(pngBuffer.buffer),
      headers: {
        get: (header: string) => {
          if (header === "content-type") {
            return "image/png";
          }
          return null;
        },
      },
    });

    const result = await fetchImageBuffer("https://example.com/image.png");

    expect(result.mimeType).toBe("image/png");
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it("should not modify JPEG files", async () => {
    // JPEG file header signature
    const JPEG_SIGNATURE_BYTE_1 = 0xff;
    const JPEG_SIGNATURE_BYTE_2 = 0xd8;
    const jpegBuffer = Buffer.from([
      JPEG_SIGNATURE_BYTE_1,
      JPEG_SIGNATURE_BYTE_2,
    ]);

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(jpegBuffer.buffer),
      headers: {
        get: (header: string) => {
          if (header === "content-type") {
            return "image/jpeg";
          }
          return null;
        },
      },
    });

    const result = await fetchImageBuffer("https://example.com/image.jpg");

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.buffer).toBeInstanceOf(Buffer);
  });
});
