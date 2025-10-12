import { GLYPHBOTS_CONTRACT_ADDRESS } from '../../src/utils/constants';
import {
  formatAmount,
  formatNftPrefix,
  imageForNFT,
} from '../../src/utils/utils';

describe('formatAmount', () => {
  test('trims to 4 decimals', () => {
    expect(formatAmount('123456', 5, 'ETH')).toBe('1.2345 ETH');
  });
  test('removes .0 for whole numbers', () => {
    expect(formatAmount('100000', 5, 'ETH')).toBe('1 ETH');
  });
});

describe('imageForNFT', () => {
  test('replaces width param with 1000', () => {
    expect(
      imageForNFT({ image_url: 'https://img.example.com/foo?w=200&h=200' })
    ).toBe('https://img.example.com/foo?w=10000&h=200');
  });
  test('returns undefined when missing', () => {
    expect(imageForNFT(undefined)).toBeUndefined();
  });
});

describe('formatNftPrefix', () => {
  const OLD_TOKEN = process.env.TOKEN_ADDRESS;
  beforeEach(() => {
    process.env.TOKEN_ADDRESS = GLYPHBOTS_CONTRACT_ADDRESS;
  });
  afterEach(() => {
    process.env.TOKEN_ADDRESS = OLD_TOKEN;
  });

  test('special contract uses name suffix and id', () => {
    const txt = formatNftPrefix({ name: 'Prefix - Suffix', identifier: '42' });
    expect(txt).toBe('Suffix #42 ');
  });
  test('falls back to identifier when name missing', () => {
    const txt = formatNftPrefix({ identifier: '7' });
    expect(txt).toBe('#7 ');
  });
});
