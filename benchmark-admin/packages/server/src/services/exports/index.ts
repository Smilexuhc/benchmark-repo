import archiver from 'archiver';
import ExcelJS from 'exceljs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import pLimit from 'p-limit';
import { EXPORT_HEADERS } from '@benchmark-admin/shared/lib/exports/headers';
import * as storage from '../storage/index.js';

export async function buildExportZip(
  _kind: string,
  items: Record<string, unknown>[],
  imageLinks: { objectKey: string; role: string; itemId: number }[],
  reply: FastifyReply,
  request?: FastifyRequest,
): Promise<void> {
  const zip = archiver('zip', { zlib: { level: 6 } });

  // Attach the drain target BEFORE appending anything — finalize-then-yield deadlocks.
  // biome-ignore lint/suspicious/noExplicitAny: Fastify raw ServerResponse
  zip.pipe((reply.raw as any));

  const done = new Promise<void>((resolve, reject) => {
    zip.on('finish', resolve);
    zip.on('error', (err) => {
      // Destroy socket so client receives a clean error rather than a partial ZIP
      reply.raw.destroy(err);
      reject(err);
    });
  });

  // Wire request abort to stop archiving mid-stream
  if (request) {
    request.raw.on('close', () => {
      zip.abort();
    });
  }

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

  // Append one image per item (first link per item wins) with bounded concurrency
  const seenItems = new Set<number>();
  const limit = pLimit(5);

  const tasks = imageLinks
    .filter((link) => {
      if (seenItems.has(link.itemId)) return false;
      seenItems.add(link.itemId);
      return true;
    })
    .map((link) =>
      limit(async () => {
        try {
          const bytes = await storage.getBytes(link.objectKey);
          zip.append(bytes, { name: `images/${link.itemId}.png` });
        } catch {
          // Skip unavailable images — don't abort the whole export
        }
      }),
    );

  await Promise.all(tasks);

  zip.finalize();
  return done;
}
