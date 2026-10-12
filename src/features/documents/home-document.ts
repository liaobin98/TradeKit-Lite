import { decodeDoc } from '@/features/documents/drafts';
import { validIssue } from '@/features/documents/document-status';
import { fresh, type Doc, type Kind } from '@/features/documents/model';

type HomeSelection = { document: Doc; unsaved: boolean; warning: string };
export function selectHomeDocument(kind: Kind, raw: string | null, askRestore: (document: Doc) => Promise<boolean>): Promise<HomeSelection>;
export function selectHomeDocument(kind: Kind, raw: string | null, askRestore: (document: Doc) => Promise<boolean | null>): Promise<HomeSelection | null>;
export async function selectHomeDocument(kind: Kind, raw: string | null, askRestore: (document: Doc) => Promise<boolean | null>): Promise<HomeSelection | null> {
  const blank = () => ({ document: fresh(kind), unsaved: true, warning: '' });
  if (raw === null) return blank();
  let previous: Doc;
  try { previous = decodeDoc(JSON.parse(raw), kind); }
  catch {
    return { ...blank(), warning: '上次草稿无法读取，已打开新表格。原始内容仍保留，保存新草稿时会另行备份。' };
  }
  if (previous.status === 'saved' || validIssue(previous.issued)) return blank();
  const restore = await askRestore(previous);
  if (restore === null) return null;
  if (!restore) return blank();
  return { document: previous, unsaved: false, warning: '' };
}
