// Server-authoritative upload validation: extension allowlist + magic-byte
// sniffing to defeat extension spoofing. Lives here (not in the Fastify route)
// so the rules are unit-testable without standing up an HTTP harness.

export type MediaKind = 'image' | 'audio' | 'video';

// Allowlisted extensions and their server-authoritative content types.
export const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

// Magic-byte signatures for quick type validation.
const MAGIC_BYTES: { sig: number[]; type: MediaKind }[] = [
  { sig: [0x89, 0x50, 0x4e, 0x47], type: 'image' }, // PNG
  { sig: [0xff, 0xd8, 0xff], type: 'image' }, // JPEG
  { sig: [0x52, 0x49, 0x46, 0x46], type: 'image' }, // WebP (RIFF container)
  { sig: [0x49, 0x44, 0x33], type: 'audio' }, // MP3 (ID3)
  { sig: [0xff, 0xfb], type: 'audio' }, // MP3 frame
  { sig: [0xff, 0xf3], type: 'audio' }, // MP3 frame
  { sig: [0x52, 0x49, 0x46, 0x46], type: 'audio' }, // WAV (RIFF)
  { sig: [0x66, 0x74, 0x79, 0x70], type: 'video' }, // MP4/MOV (ftyp box at offset 4)
  { sig: [0x1a, 0x45, 0xdf, 0xa3], type: 'video' }, // WebM (EBML)
];

export function detectMimeFromBytes(bytes: Buffer): MediaKind | null {
  for (const { sig, type } of MAGIC_BYTES) {
    // MP4/MOV ftyp box is at offset 4
    const offset = sig[0] === 0x66 ? 4 : 0;
    if (bytes.length >= offset + sig.length) {
      const match = sig.every((b, i) => bytes[offset + i] === b);
      if (match) return type;
    }
  }
  return null;
}

export type UploadValidation =
  | { ok: true; ext: string; contentType: string; prefix: 'images' | 'audios' | 'videos' }
  | { ok: false; error: string };

// Validate a filename + body. Pure: no I/O, so it's directly unit-testable.
export function validateUpload(filename: string, bytes: Buffer): UploadValidation {
  const ext = (filename.split('.').pop() ?? 'bin').toLowerCase();

  const contentType = EXT_TO_CONTENT_TYPE[ext];
  if (!contentType) return { ok: false, error: 'Unsupported file type' };

  const expectedType = contentType.split('/')[0] as MediaKind;
  const detectedType = detectMimeFromBytes(bytes);
  if (detectedType !== null && detectedType !== expectedType) {
    return { ok: false, error: 'File content does not match extension' };
  }

  const prefix: 'images' | 'audios' | 'videos' =
    expectedType === 'image' ? 'images' : expectedType === 'audio' ? 'audios' : 'videos';

  return { ok: true, ext, contentType, prefix };
}
