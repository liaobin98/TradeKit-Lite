import { validIssue } from '@/features/documents/document-status';
import { type Doc } from '@/features/documents/model';
import '@/features/documents/document-status.css';

export function DocumentStatus({ doc }: { doc: Doc }) {
  if (doc.status === 'saved' || doc.status === undefined && validIssue(doc.issued)) return null;
  return <span className="document-status document-status-draft">草稿</span>;
}
