import { describe, expect, it } from 'vitest';
import { documentLinkCodec } from '@/features/documents/document-links';
import { newDocument } from '@/features/documents/documents-store';
import { numberRoute, recordRoute, routeKind, routeDocumentNumber } from '@/app/navigation';

describe('number-based document links', () => {
  it('shows the document number while resolving to the stable internal ID', () => {
    const doc = newDocument('QT'); doc.fields.number = 'QT-202610-4982';
    const codec = documentLinkCodec(() => [doc]), route = recordRoute(doc.kind, doc.id!);
    expect(codec.hash(route)).toBe('#/documents/qt/QT-202610-4982');
    expect(codec.parse(codec.hash(route))).toBe(route);
    expect(codec.parse('#/documents/qt/' + doc.id)).toBe(numberRoute('QT', doc.id!));
  });
  it.each(['报价 2026/10:001', 'QT?#&%+001', 'QT-😀', '__proto__'])('encodes and round trips a custom number %s', number => {
    const doc = newDocument('QT'); doc.fields.number = number;
    const codec = documentLinkCodec(() => [doc]);
    expect(codec.hash(recordRoute('QT', doc.id!))).toBe('#/documents/qt/' + encodeURIComponent(number));
    expect(codec.parse(codec.hash(recordRoute('QT', doc.id!)))).toBe(recordRoute('QT', doc.id!));
  });
  it('uses the current editing number before autosave, without changing another record', () => {
    const saved = newDocument('QT'); saved.fields.number = 'OLD';
    const current = { ...saved, fields: { ...saved.fields, number: 'NEW' } }, other = newDocument('PI');
    const codec = documentLinkCodec(() => [saved, other], () => current);
    expect(codec.hash(recordRoute('QT', saved.id!))).toBe('#/documents/qt/NEW');
    expect(codec.parse('#/documents/qt/NEW')).toBe(recordRoute('QT', saved.id!));
    expect(saved.fields.number).toBe('OLD');
  });
  it('shows an unsaved blank number without requiring a record to be created', () => {
    const current = newDocument('SC'), codec = documentLinkCodec(() => [], () => current);
    expect(codec.hash(recordRoute('SC', current.id!))).toBe('#/documents/sc/' + current.fields.number);
    expect(codec.parse(codec.hash(recordRoute('SC', current.id!)))).toBe(recordRoute('SC', current.id!));
  });
  it('adds a record hint for duplicate numbers and never guesses a matching record', () => {
    const first = newDocument('QT'), second = newDocument('QT'); first.fields.number = second.fields.number = 'SAME';
    const codec = documentLinkCodec(() => [first, second]);
    for (const doc of [first, second]) {
      const route = recordRoute('QT', doc.id!);
      expect(codec.hash(route)).toBe('#/documents/qt/SAME?record=' + doc.id);
      expect(codec.parse(codec.hash(route))).toBe(route);
    }
    expect(codec.parse('#/documents/qt/SAME')).toBe(numberRoute('QT', 'SAME'));
    expect(codec.parse('#/documents/pi/SAME?record=' + first.id)).toBe(numberRoute('PI', 'SAME'));
    expect(codec.parse('#/documents/qt/WRONG?record=' + first.id)).toBe(numberRoute('QT', 'WRONG'));
  });
  it('allows the same number across types without extra hints', () => {
    const first = newDocument('QT'), second = newDocument('PI'); first.fields.number = second.fields.number = 'SAME';
    const codec = documentLinkCodec(() => [first, second]);
    expect(codec.hash(recordRoute('QT', first.id!))).toBe('#/documents/qt/SAME');
    expect(codec.parse('#/documents/pi/SAME')).toBe(recordRoute('PI', second.id!));
  });
  it('keeps records with empty numbers addressable, without using an ID as the path segment', () => {
    const doc = newDocument('QT'); doc.fields.number = '';
    const codec = documentLinkCodec(() => [doc]), route = recordRoute('QT', doc.id!);
    expect(codec.hash(route)).toBe('#/documents/qt/_?record=' + doc.id);
    expect(codec.parse(codec.hash(route))).toBe(route);
  });
  it('returns an unresolved number route for deleted/unknown numbers and rejects malformed links', () => {
    const codec = documentLinkCodec(() => []);
    const missing = codec.parse('#/documents/qt/MISSING');
    expect(routeKind(missing)).toBe('QT'); expect(routeDocumentNumber(missing)).toBe('MISSING');
    for (const hash of ['#/documents/qt/%', '#/documents/qt/%00', '#/documents/qt/A/B', '#/documents/nope/A', '#/documents/qt/A?unexpected=1']) expect(codec.parse(hash)).toBeNull();
    expect(codec.parse('#/documents')).toBe('documents'); expect(codec.parse('#/products')).toBe('products');
  });
});
