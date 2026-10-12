import { afterEach, describe, expect, it, vi } from 'vitest';
import { printDocument } from '../../src/features/documents/export';
import { fresh } from '../../src/features/documents/model';

afterEach(() => vi.unstubAllGlobals());

function environment(images: { decode: () => Promise<void> }[] = [], hasPreview = true) {
  const print = vi.fn();
  const ready = Promise.resolve();
  const querySelectorAll = vi.fn(() => hasPreview ? [{ querySelectorAll: () => images }] : []);
  vi.stubGlobal('document', { fonts: { ready }, querySelectorAll });
  vi.stubGlobal('window', { print });
  return { print, querySelectorAll };
}

describe('preview printing', () => {
  it('prints the current preview through the browser', async () => {
    const { print, querySelectorAll } = environment();
    await printDocument(fresh('SC'));
    expect(querySelectorAll).toHaveBeenCalledWith('.preview > .paper');
    expect(print).toHaveBeenCalledOnce();
  });

  it('waits for fonts and every preview image before printing', async () => {
    let resolveFonts!: () => void;
    let resolveImage!: () => void;
    const decode = vi.fn(() => new Promise<void>(resolve => { resolveImage = resolve; }));
    const { print } = environment([{ decode }, { decode: () => Promise.resolve() }]);
    vi.stubGlobal('document', {
      fonts: { ready: new Promise<void>(resolve => { resolveFonts = resolve; }) },
      querySelectorAll: () => [{ querySelectorAll: () => [{ decode }, { decode: () => Promise.resolve() }] }],
    });
    const task = printDocument(fresh('QT'));
    expect(decode).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    resolveFonts();
    await Promise.resolve();
    expect(decode).toHaveBeenCalledOnce();
    expect(print).not.toHaveBeenCalled();
    resolveImage();
    await task;
    expect(print).toHaveBeenCalledOnce();
  });

  it('does not print invalid numbers or a missing preview', async () => {
    const { print } = environment([], false);
    const invalid = fresh('QT'); invalid.rows[0].price = '-1';
    await expect(printDocument(invalid)).rejects.toThrow();
    await expect(printDocument(fresh('QT'))).rejects.toThrow('未找到当前单据预览');
    expect(print).not.toHaveBeenCalled();
  });

  it('reports image failures rather than silently printing without images', async () => {
    const { print } = environment([{ decode: () => Promise.reject(Error('图片加载失败')) }]);
    await expect(printDocument(fresh('PI'))).rejects.toThrow('图片加载失败');
    expect(print).not.toHaveBeenCalled();
  });

  it('propagates browser printing failures', async () => {
    const { print } = environment();
    print.mockImplementation(() => { throw Error('打印不可用'); });
    await expect(printDocument(fresh('PL'))).rejects.toThrow('打印不可用');
  });
});
