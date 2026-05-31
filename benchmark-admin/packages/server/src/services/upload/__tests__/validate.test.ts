import { describe, expect, it } from 'vitest';
import { detectMimeFromBytes, validateUpload } from '../validate.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]);
const MP4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // ftyp at offset 4
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);

describe('detectMimeFromBytes', () => {
  it('detects image, audio, and video signatures', () => {
    expect(detectMimeFromBytes(PNG)).toBe('image');
    expect(detectMimeFromBytes(JPEG)).toBe('image');
    expect(detectMimeFromBytes(MP3)).toBe('audio');
    expect(detectMimeFromBytes(MP4)).toBe('video');
    expect(detectMimeFromBytes(WEBM)).toBe('video');
  });

  it('returns null for unrecognized bytes', () => {
    expect(detectMimeFromBytes(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('validateUpload', () => {
  it('accepts a png with matching extension and returns server-authoritative type', () => {
    const r = validateUpload('photo.PNG', PNG);
    expect(r).toEqual({ ok: true, ext: 'png', contentType: 'image/png', prefix: 'images' });
  });

  it('routes audio and video to the correct prefix', () => {
    expect(validateUpload('clip.mp3', MP3)).toMatchObject({
      prefix: 'audios',
      contentType: 'audio/mpeg',
    });
    expect(validateUpload('clip.mp4', MP4)).toMatchObject({
      prefix: 'videos',
      contentType: 'video/mp4',
    });
  });

  it('rejects an extension outside the allowlist', () => {
    expect(validateUpload('malware.exe', PNG)).toEqual({
      ok: false,
      error: 'Unsupported file type',
    });
    expect(validateUpload('noext', PNG)).toEqual({ ok: false, error: 'Unsupported file type' });
  });

  it('rejects extension spoofing — png bytes renamed to .mp4', () => {
    expect(validateUpload('fake.mp4', PNG)).toEqual({
      ok: false,
      error: 'File content does not match extension',
    });
  });

  it('allows an allowlisted extension when bytes are unrecognized (sniff is best-effort)', () => {
    // A valid wav whose RIFF header we do not over-strictly verify should still pass.
    const r = validateUpload('audio.wav', Buffer.from([0x00, 0x11, 0x22, 0x33]));
    expect(r).toMatchObject({ ok: true, prefix: 'audios' });
  });
});
