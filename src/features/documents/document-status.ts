import { type Doc } from '@/features/documents/model';
import { validateIssueCompleteness } from '@/features/documents/validation';

// Legacy output metadata helpers, retained for old backup decoding/tests only.
// The live editor uses Doc.status and never changes it because of output or edits.

export type IssueMethod = NonNullable<Doc['issued']>['via'];
const methodLabels: Record<IssueMethod, string> = { excel: '导出 Excel', pdf: '导出 PDF', print: '调用打印' };

export function validIssue(value: unknown): value is NonNullable<Doc['issued']> {
  if (!value || typeof value !== 'object') return false;
  const issue = value as Record<string, unknown>;
  return typeof issue.via === 'string' && Object.hasOwn(methodLabels, issue.via) &&
    typeof issue.at === 'string' && Number.isFinite(Date.parse(issue.at));
}

function content(doc: Doc) {
  const sorted = (record: Record<string, string>) => Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    doc.version, doc.kind, sorted(doc.fields), doc.rows.map(row => sorted(row)),
    doc.language, doc.theme, doc.layout, doc.logo, doc.seal, doc.notes,
  ]);
}

export function sameDocumentContent(a: Doc, b: Doc) {
  return a === b || content(a) === content(b);
}

// Issued documents remain read-only until the user explicitly reopens them.
export function editDocument(current: Doc, next: Doc): Doc {
  if (validIssue(current.issued)) return current;
  const { issued: _issued, ...draft } = next;
  return draft;
}

export function reopenDocument(doc: Doc): Doc {
  const { issued: _issued, ...draft } = doc;
  return draft;
}

// Only the snapshot actually exported/printed may become an issued document.
export function issueDocument(current: Doc, snapshot: Doc, via: IssueMethod, at = new Date().toISOString()): Doc {
  return sameDocumentContent(current, snapshot) && validIssue({ via, at }) && !validateIssueCompleteness(current).length
    ? { ...current, issued: { via, at } } : current;
}

export type PendingIssue = { snapshot: Doc; via: IssueMethod; at: string };

// Output never locks a draft in place. Only leaving an unchanged document
// through the app commits its latest successful export/print status.
export function deferDocumentIssue(current: Doc, snapshot: Doc, via: IssueMethod, at = new Date().toISOString()): PendingIssue | null {
  if (validIssue(current.issued) || !sameDocumentContent(current, snapshot) || !validIssue({ via, at }) || validateIssueCompleteness(current).length) return null;
  return { snapshot: structuredClone(snapshot), via, at };
}
export function retainPendingIssue(pending: PendingIssue | null, current: Doc): PendingIssue | null {
  return pending && !validIssue(current.issued) && sameDocumentContent(current, pending.snapshot) ? pending : null;
}
export function issuePendingDocument(current: Doc, pending: PendingIssue | null): Doc {
  const eligible = retainPendingIssue(pending, current);
  return eligible ? issueDocument(current, eligible.snapshot, eligible.via, eligible.at) : current;
}

export function documentStatus(doc: Doc) {
  if (!validIssue(doc.issued)) return { value: 'draft', label: '草稿单', description: '核心资料完整、打印或导出 PDF/Excel 后未再修改并离开单据页时才标记为已出单；资料不完整、自动保存和保存草稿不会标记。' } as const;
  const detail = doc.issued.via === 'print' ? '（输出后未再修改并离开单据页；浏览器无法确认实际打印完成或取消）' : '（已生成文件并发起下载，之后未再修改并离开单据页）';
  return { value: 'issued', label: '已出单', description: `${methodLabels[doc.issued.via]}${detail}；当前为只读，点击“重新编辑”后恢复为草稿单。` } as const;
}
