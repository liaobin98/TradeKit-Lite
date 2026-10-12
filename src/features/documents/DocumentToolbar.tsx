import { ArrowLeft, FilePlus2, Save, Download, FileText, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusNotice, type StatusMessage } from '@/components/StatusNotice';
import { types, type Kind, type Doc } from '@/features/documents/model';
import { excel, pdf } from '@/features/documents/export';
import type { ValidationIssue } from '@/features/documents/validation';

type Props = {
  kind: Kind;
  doc: Doc;
  busy: boolean;
  issues: ValidationIssue[];
  feedback: StatusMessage | null;
  back: () => void;
  blank: () => Promise<void>;
  saveCurrent: (asDraft: boolean) => Promise<void>;
  exporting: (fn: typeof excel) => Promise<void>;
  printing: () => Promise<void>;
};

export function DocumentToolbar({ kind, doc, busy, issues, feedback, back, blank, saveCurrent, exporting, printing }: Props) {
  return (
    <>
    <nav className="toolbar">
      <div className="workspace-heading">
      <Button disabled={busy} onClick={back}>
        <ArrowLeft size={16} aria-hidden="true" />
        返回
      </Button>
      <div className="workspace-title">
        <small>ONLINE DOCUMENT TOOL</small>
        <h2>{kind === "PI" ? "PI" : types[kind][0]}</h2>
        <span>{doc.fields.number}</span>
      </div>
      </div>
      <div className="workspace-save-feedback"><StatusNotice message={feedback} /></div>
      <div className="workspace-actions">
      <Button disabled={busy} onClick={blank}>
        <FilePlus2 size={16} aria-hidden="true" />
        新建空白
      </Button>
      <Button disabled={busy} onClick={() => void saveCurrent(true)}><Save size={16} aria-hidden="true" />保存草稿</Button>
      <Button variant="default" disabled={busy} onClick={() => void saveCurrent(false)}><Save size={16} aria-hidden="true" />保存</Button>
      <Button disabled={busy || issues.length > 0} aria-describedby={issues.length ? 'validation-summary' : undefined} onClick={() => exporting(excel)}>
        <Download size={16} aria-hidden="true" />
        Excel
      </Button>
      <Button disabled={busy || issues.length > 0} aria-describedby={issues.length ? 'validation-summary' : undefined} onClick={() => exporting(pdf)}>
        <FileText size={16} aria-hidden="true" />
        PDF
      </Button>
      <Button disabled={busy || issues.length > 0} aria-describedby={issues.length ? 'validation-summary' : undefined} onClick={printing} title="打印当前预览单据">
        <Printer size={16} aria-hidden="true" />
        打印
      </Button>
      </div>
    </nav>
    {issues.length > 0 && <section id="validation-summary" className="validation-summary" role="alert"><strong>请修正以下数值后导出或打印（仍可保存单据和草稿）</strong><ul>{issues.map(i => <li key={i.path}>{i.label}：{i.message}</li>)}</ul></section>}
    </>
  );
}
