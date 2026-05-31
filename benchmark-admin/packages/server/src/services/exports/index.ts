import { extname } from 'node:path';
import archiver from 'archiver';
import ExcelJS from 'exceljs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { EXPORT_HEADERS } from '@benchmark-admin/shared/lib/exports/headers';
import * as storage from '../storage/index.js';

export type ExportMediaLink = {
  objectKey: string;
  role: string;
  itemId: number;
  mediaType?: 'image' | 'audio' | 'video';
};

type ItemMedia = {
  images: { role: string; objectKey: string }[];
  audioInput: string | null;
  videoInput: string | null;
  videoOutput: string | null;
};

function groupMedia(links: ExportMediaLink[]): Map<number, ItemMedia> {
  const byItem = new Map<number, ItemMedia>();
  const ensure = (id: number): ItemMedia => {
    let m = byItem.get(id);
    if (!m) {
      m = { images: [], audioInput: null, videoInput: null, videoOutput: null };
      byItem.set(id, m);
    }
    return m;
  };
  for (const link of links) {
    const m = ensure(link.itemId);
    switch (link.role) {
      case 'character_image':
      case 'scene_image':
      case 'prop_image':
        m.images.push({ role: link.role, objectKey: link.objectKey });
        break;
      case 'audio_input':
        m.audioInput = link.objectKey;
        break;
      case 'video_input':
        m.videoInput = link.objectKey;
        break;
      case 'video_output':
        m.videoOutput = link.objectKey;
        break;
    }
  }
  return byItem;
}

function completenessLabel(item: Record<string, unknown>, m: ItemMedia | undefined): string {
  const missing: string[] = [];
  if (!String(item.textPrompt ?? '').trim()) missing.push('缺提示词');
  if (!String(item.judgingCriteria ?? '').trim()) missing.push('缺评判标准');
  if (item.score === null || item.score === undefined) missing.push('未评分');
  const hasInput =
    !!m && (m.images.length > 0 || m.audioInput !== null || m.videoInput !== null);
  if (!hasInput) missing.push('缺输入媒体');
  if (!m || m.videoOutput === null) missing.push('缺输出视频');
  return missing.length === 0 ? '完整' : missing.join('; ');
}

// Append one object as a stream so bytes flow archive→socket without buffering
// the whole object in memory. Awaiting the source stream's end keeps at most one
// S3 connection open at a time. Missing/unreadable objects are skipped, not fatal.
async function appendObjectStream(
  zip: archiver.Archiver,
  objectKey: string,
  name: string,
): Promise<void> {
  let stream: Awaited<ReturnType<typeof storage.getStream>>;
  try {
    stream = await storage.getStream(objectKey);
  } catch {
    return; // object unavailable — skip
  }
  zip.append(stream, { name });
  await new Promise<void>((resolve) => {
    stream.on('end', () => resolve());
    stream.on('error', () => resolve()); // archiver records the error; don't reject the whole export
  });
}

export async function buildExportZip(
  _kind: string,
  items: Record<string, unknown>[],
  mediaLinks: ExportMediaLink[],
  reply: FastifyReply,
  request?: FastifyRequest,
): Promise<void> {
  const zip = archiver('zip', { zlib: { level: 6 } });

  // Attach the drain target BEFORE appending anything — finalize-then-yield deadlocks.
  // biome-ignore lint/suspicious/noExplicitAny: Fastify raw ServerResponse
  zip.pipe(reply.raw as any);

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

  const byItem = groupMedia(mediaLinks);

  // Build XLSX manifest with media-coverage + completeness columns
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('manifest');
  const keys = Object.keys(EXPORT_HEADERS);
  ws.columns = keys.map((k) => ({ header: EXPORT_HEADERS[k] ?? k, key: k }));

  for (const item of items) {
    const m = byItem.get(item.id as number);
    const counts = {
      characterImageCount: m ? m.images.filter((i) => i.role === 'character_image').length : 0,
      sceneImageCount: m ? m.images.filter((i) => i.role === 'scene_image').length : 0,
      propImageCount: m ? m.images.filter((i) => i.role === 'prop_image').length : 0,
      audioInput: m?.audioInput ? '有' : '',
      videoInput: m?.videoInput ? '有' : '',
      videoOutput: m?.videoOutput ? '有' : '',
      completeness: completenessLabel(item, m),
    };
    ws.addRow(
      Object.fromEntries(
        keys.map((k) => [k, k in counts ? (counts as Record<string, unknown>)[k] : (item[k] ?? '')]),
      ),
    );
  }

  const xlsxBuffer = await wb.xlsx.writeBuffer();
  zip.append(Buffer.from(xlsxBuffer), { name: 'manifest.xlsx' });

  // Bundle ALL media per item — every image (multi-image preserved), plus audio
  // and video inputs/outputs — streamed sequentially to bound memory.
  for (const [itemId, m] of byItem) {
    const roleCounters: Record<string, number> = {};
    for (const img of m.images) {
      const n = (roleCounters[img.role] = (roleCounters[img.role] ?? 0) + 1);
      await appendObjectStream(zip, img.objectKey, `images/${itemId}/${img.role}_${n}${extname(img.objectKey)}`);
    }
    if (m.audioInput) {
      await appendObjectStream(zip, m.audioInput, `audios/${itemId}${extname(m.audioInput)}`);
    }
    if (m.videoInput) {
      await appendObjectStream(zip, m.videoInput, `videos/${itemId}_input${extname(m.videoInput)}`);
    }
    if (m.videoOutput) {
      await appendObjectStream(zip, m.videoOutput, `videos/${itemId}_output${extname(m.videoOutput)}`);
    }
  }

  zip.finalize();
  return done;
}
