import archiver from 'archiver';
import ExcelJS from 'exceljs';
import type { FastifyReply } from 'fastify';
import { EXPORT_HEADERS } from '@benchmark-admin/shared/lib/exports/headers';
import * as storage from '../storage/index.js';

export async function buildExportZip(
  _kind: string,
  items: Record<string, unknown>[],
  imageLinks: { objectKey: string; role: string; itemId: number }[],
  reply: FastifyReply,
): Promise<void> {
  const zip = archiver('zip', { zlib: { level: 6 } });

  // Attach the drain target BEFORE appending anything — finalize-then-yield deadlocks.
  // biome-ignore lint/suspicious/noExplicitAny: Fastify raw ServerResponse
  zip.pipe((reply.raw as any));

  // Set up done-promise BEFORE finalize() so we never miss the event
  const done = new Promise<void>((resolve, reject) => {
    zip.on('finish', resolve);
    zip.on('error', reject);
  });

  // Build XLSX manifest
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('manifest');

  const keys = Object.keys(EXPORT_HEADERS);
  ws.columns = keys.map((k) => ({ header: EXPORT_HEADERS[k] ?? k, key: k }));

  for (const item of items) {
    ws.addRow(Object.fromEntries(keys.map((k) => [k, item[k] ?? ''])));
  }

  const xlsxBuffer = await wb.xlsx.writeBuffer();
  zip.append(Buffer.from(xlsxBuffer), { name: 'manifest.xlsx' });

  // Append one image per item (first link per item wins)
  const seenItems = new Set<number>();
  for (const link of imageLinks) {
    if (seenItems.has(link.itemId)) continue;
    seenItems.add(link.itemId);
    try {
      const bytes = await storage.getBytes(link.objectKey);
      zip.append(bytes, { name: `images/${link.itemId}.png` });
    } catch {
      // Skip unavailable images — don't abort the whole export
    }
  }

  zip.finalize();
  return done;
}
