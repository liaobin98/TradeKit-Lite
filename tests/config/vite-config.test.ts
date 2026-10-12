import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import config, { devCacheDir } from '../../vite.config';

describe('development React loading', () => {
  it('pins React and its renderer to one installation, including nested dependencies', () => {
    expect(config.resolve?.alias).toMatchObject({
      react: fileURLToPath(new URL('../../node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('../../node_modules/react-dom', import.meta.url)),
    });
    expect(config.resolve?.dedupe).toEqual(expect.arrayContaining(['react', 'react-dom']));
    expect(config.optimizeDeps?.include).toEqual(expect.arrayContaining(['react', 'react-dom/client', 'react/jsx-runtime']));
  });
  it('keeps main and temporary preview dependency caches separate', () => {
    expect(devCacheDir()).toBe(devCacheDir(5173));
    expect(devCacheDir(5173)).not.toBe(devCacheDir(5176));
  });
});
