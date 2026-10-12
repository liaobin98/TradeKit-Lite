import { describe, expect, it } from 'vitest';
import { packValue, unpackValue, mapStorage, WORKSPACE_PREFIX } from '@/features/workspace/workspace-storage';

describe('large workspace data and shared images', () => {
  it('stores one copy of an image shared by drafts, settings and multiple catalog sources', () => {
    const images = new Map(), image = 'data:image/png;base64,AAAA';
    const first = packValue(JSON.stringify({ logo: image, rows: [{ image }], images: [image] }), images);
    const second = packValue(JSON.stringify({ image, archived: image }), images);
    expect(images.size).toBe(1);
    const byId = new Map([...images.values()].map(value => [value.id, value.data]));
    expect(JSON.parse(unpackValue(first, byId)).rows[0].image).toBe(image);
    expect(JSON.parse(unpackValue(second, byId)).archived).toBe(image);
    expect(JSON.stringify(first)).not.toContain(image);
  });
  it('preserves exact whitespace, damaged raw data and image-like user text', () => {
    for (const raw of ['{broken', '{\n "image": "data:image/webp;base64,BBBB=="\n}', 'Text data:image/png;base64,AAAA more text', '{"parts":[{"image":"user text"}]}']) {
      const images = new Map(), packed = packValue(raw, images);
      const byId = new Map([...images.values()].map(value => [value.id, value.data]));
      expect(unpackValue(packed, byId)).toBe(raw);
    }
  });
  it('refuses to silently replace missing images with empty data', () => {
    expect(() => unpackValue({ parts: [{ image: 'missing' }] }, new Map())).toThrow('图片副本缺失');
  });
  it('keeps similarly shaped but different images separate', () => {
    const images = new Map(); packValue('data:image/png;base64,AAAA', images); packValue('data:image/png;base64,AAAB', images);
    expect(images.size).toBe(2);
  });
  it('allows staged writes without exposing them to a committed read snapshot', () => {
    const committed = new Map([[WORKSPACE_PREFIX + 'draft:QT', 'previous']]);
    const staged = mapStorage(new Map(committed), true), read = mapStorage(committed);
    staged.setItem(WORKSPACE_PREFIX + 'draft:QT', 'next');
    expect(read.getItem(WORKSPACE_PREFIX + 'draft:QT')).toBe('previous');
    expect(() => read.setItem(WORKSPACE_PREFIX + 'draft:QT', 'bad')).toThrow('事务');
    expect(() => staged.setItem('another-app', 'bad')).toThrow('不支持');
    expect(() => staged.clear()).toThrow('不允许');
  });
});
