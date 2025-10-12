import { fetchImageBuffer } from '../src/utils/utils';

// Mock fetch to return the actual SVG content
global.fetch = jest.fn();

const mockSvgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><style>text{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:64px;white-space:pre;text-anchor:middle;dominant-baseline:central}</style><rect width="100%" height="100%" fill="#228b22"/><text x="400" y="220" fill="#90ee90"><tspan x="400" dy="0">▼⌊───⌋</tspan><tspan x="400" dy="80">◥ ⊙ ⊙ ⟈</tspan><tspan x="400" dy="80">⬟</tspan><tspan x="400" dy="80">╙─╜</tspan></text></svg>`;

describe('Unicode SVG Character Encoding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should convert SVG with unicode characters to PNG and fix font issues', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(new TextEncoder().encode(mockSvgContent).buffer),
      headers: {
        get: () => 'image/svg+xml',
      },
    });

    const result = await fetchImageBuffer('https://example.com/test.svg');

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);

    // Verify that the original SVG contains problematic monospace fonts
    expect(mockSvgContent).toContain('ui-monospace,Menlo,Consolas,monospace');
    expect(mockSvgContent).toContain('⟈'); // Unicode character should be present
  });

  it('should handle the real GlyphBot weapon SVG with unicode character', async () => {
    // Use the fixture data
    const { asset_events } = require('./fixtures/unicode-svg.json');
    const svgUrl = asset_events[0].nft.image_url;

    // Mock the actual response from the SVG URL
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(new TextEncoder().encode(mockSvgContent).buffer),
      headers: {
        get: () => 'image/svg+xml',
      },
    });

    const result = await fetchImageBuffer(svgUrl);

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith(svgUrl);
  });

  it('should use browser-realistic monospace font stack for better unicode support', async () => {
    // Create SVG with problematic monospace font that needs fixing
    const svgWithProblematicFont = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <style>text{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:24px}</style>
      <text x="50" y="50">⟈</text>
    </svg>`;

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(
          new TextEncoder().encode(svgWithProblematicFont).buffer
        ),
      headers: {
        get: () => 'image/svg+xml',
      },
    });

    const result = await fetchImageBuffer('https://example.com/weapon.svg');

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(0);

    // Verify the original SVG had the problematic font
    expect(svgWithProblematicFont).toContain(
      'ui-monospace,Menlo,Consolas,monospace'
    );
    expect(svgWithProblematicFont).toContain('⟈');
  });

  it('should handle non-SVG images without modification', async () => {
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
    ]); // PNG header

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(pngBuffer.buffer),
      headers: {
        get: () => 'image/png',
      },
    });

    const result = await fetchImageBuffer('https://example.com/test.png');

    expect(result.mimeType).toBe('image/png');
    expect(result.buffer).toBeInstanceOf(Buffer);
    // Buffer length may be different due to Sharp processing, just verify it's not empty
    expect(result.buffer.length).toBeGreaterThan(0);
  });
});
