// 用独立的固定宽度预览分页，避免导出结果受窗口宽度和编辑器布局影响。
export async function createPdfPages(source: HTMLElement) {
  await document.fonts.ready;
  const frame = document.createElement('iframe');
  frame.title = 'PDF 导出排版'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
  Object.assign(frame.style, { position: 'absolute', left: '-10000px', top: '0', width: '1280px', height: '1200px', border: '0' });
  document.body.append(frame);
  const target = frame.contentDocument!;
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'));
  const loaded = styles.map(style => {
    const copy = style.cloneNode(true) as HTMLElement;
    const ready = copy.tagName === 'LINK' ? new Promise<void>((resolve, reject) => { copy.onload = () => resolve(); copy.onerror = () => reject(Error('无法加载 PDF 排版样式')); }) : Promise.resolve();
    target.head.append(copy); return ready;
  });
  try { await Promise.all(loaded); await target.fonts.ready; }
  catch (error) { frame.remove(); throw error; }
  const host = target.createElement('section');
  host.className = 'preview reference-preview';
  Object.assign(host.style, { position: 'static', width: '720px', height: 'auto', display: 'block', maxWidth: 'none', overflow: 'visible' });
  target.body.append(host);
  const pages: HTMLElement[] = [];
  const width = 720, height = width * 277 / 190;
  const header = Array.from(source.children).filter(child => child.matches('.preview-letterhead, .preview-doc-heading'));
  function nextPage() {
    const page = source.cloneNode(false) as HTMLElement;
    Object.assign(page.style, { width: `${width}px`, maxWidth: 'none', minHeight: '0', height: 'auto', aspectRatio: 'auto', margin: '0', boxSizing: 'border-box' });
    for (const child of header) page.append(child.cloneNode(true));
    host.append(page); pages.push(page);
    return page;
  }
  async function images(element: HTMLElement) {
    await Promise.all(Array.from(element.querySelectorAll('img')).map(image => image.decode()));
  }
  let page = nextPage();
  const fits = () => page.getBoundingClientRect().height <= height;
  const tooTall = () => Error('单个产品或说明超过一页，请缩短该项说明或拆分产品后重新导出。');
  try {
    await images(page);
    const body = Array.from(source.children).filter(child => !header.includes(child));
    for (const [index, child] of body.entries()) {
      // 合计、条款和银行信息能放在同页时整体移动，避免银行信息单独占一页。
      if (child.matches('.reference-total')) {
        const footer = body.slice(index).map(node => node.cloneNode(true) as HTMLElement);
        page.append(...footer); await images(page);
        if (fits()) break;
        footer.forEach(node => node.remove());
        const before = page;
        page = nextPage(); page.append(...footer); await images(page);
        if (fits()) break;
        page.remove(); pages.pop(); page = before;
      }
      if (child.matches('.preview-remarks')) {
        const text = Array.from(child.querySelector('p')?.textContent ?? '');
        let offset = 0;
        while (offset < text.length) {
          const copy = child.cloneNode(true) as HTMLElement;
          const paragraph = copy.querySelector('p')!;
          page.append(copy);
          let low = 0, high = text.length - offset;
          while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            paragraph.textContent = text.slice(offset, offset + mid).join('');
            if (fits()) low = mid; else high = mid - 1;
          }
          if (!low) {
            copy.remove(); page = nextPage(); await images(page); page.append(copy);
            paragraph.textContent = text[offset];
            if (!fits()) throw tooTall();
            copy.remove(); continue;
          }
          paragraph.textContent = text.slice(offset, offset + low).join(''); offset += low;
          if (offset < text.length) { page = nextPage(); await images(page); }
        }
      } else if (child.matches('.reference-product-table')) {
        const template = child.cloneNode(true) as HTMLTableElement;
        template.tBodies[0].replaceChildren();
        let table = template.cloneNode(true) as HTMLTableElement;
        page.append(table);
        for (const row of Array.from((child as HTMLTableElement).tBodies[0].rows)) {
          const copy = row.cloneNode(true) as HTMLTableRowElement;
          table.tBodies[0].append(copy); await images(copy);
          if (!fits()) {
            copy.remove();
            if (!table.tBodies[0].rows.length) table.remove();
            page = nextPage(); await images(page);
            table = template.cloneNode(true) as HTMLTableElement;
            page.append(table); table.tBodies[0].append(copy);
            if (!fits()) throw tooTall();
          }
        }
      } else {
        const copy = child.cloneNode(true) as HTMLElement;
        page.append(copy); await images(copy);
        if (!fits()) {
          copy.remove(); page = nextPage(); await images(page); page.append(copy);
          if (!fits()) throw tooTall();
        }
      }
    }
    return { pages, dispose: () => frame.remove() };
  } catch (error) { frame.remove(); throw error; }
}
