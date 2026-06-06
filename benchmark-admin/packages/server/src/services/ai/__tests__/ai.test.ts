import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.TEXT_MODEL = 'openai/gpt-4o-mini';
  process.env.IMAGE_MODEL = 'openai/dall-e-3';
  process.env.IMAGE_ASPECT_RATIO = '3:2';
  process.env.IMAGE_SIZE = '2K';
  process.env.TOS_BUCKET = 'test-bucket';
  process.env.TOS_REGION = 'us-east-1';
  process.env.TOS_ENDPOINT = 'https://tos.example.com';
  process.env.TOS_ACCESS_KEY_ID = 'test-key-id';
  process.env.TOS_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.SESSION_SECRET = '0'.repeat(64);
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.ADMIN_PASSWORD = 'password';
});

const mockCreate = vi.fn();

vi.mock('../openrouter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../openrouter.js')>();
  return {
    ...actual,
    openai: {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    },
  };
});

vi.mock('../../storage/index.js', () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
  newObjectKey: vi.fn().mockReturnValue('images/test-generated.png'),
  getBytes: vi.fn().mockResolvedValue(Buffer.from('test-image-data')),
  getPresignedUrl: vi.fn().mockResolvedValue('https://cdn.example.com/images/test.png'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  healthCheck: vi.fn().mockResolvedValue(true),
}));

beforeEach(() => {
  mockCreate.mockReset();
});

describe('generatePrompt — character variants', () => {
  it('uses human system prompt for plain character (no type)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A split-screen character design sheet...' } }],
    });
    const { generatePrompt } = await import('../index.js');
    const result = await generatePrompt('character', { era: '古代', gender: '男' });
    expect(result.length).toBeGreaterThan(0);
    expect(mockCreate).toHaveBeenCalledOnce();
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]?.role).toBe('system');
    // Default human prompt contains "split-screen character design sheet"
    expect(call.messages[0]?.content).toContain('分屏角色设计稿');
  });

  it('uses animal system prompt for type=动物/宠物', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A split-screen animal design sheet...' } }],
    });
    const { generatePrompt } = await import('../index.js');
    await generatePrompt('character', { type: '动物/宠物', era: '现代' });
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]?.content).toContain('分屏动物设计稿');
  });

  it('uses creature system prompt for type=怪兽', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A split-screen creature design sheet...' } }],
    });
    const { generatePrompt } = await import('../index.js');
    await generatePrompt('character', { type: '怪兽', era: '奇幻' });
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]?.content).toContain('分屏幻想生物设计稿');
  });

  it('uses anthro system prompt for type=动物拟人', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A split-screen character design sheet (anthro)...' } }],
    });
    const { generatePrompt } = await import('../index.js');
    await generatePrompt('character', { type: '动物拟人', era: '现代' });
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]?.content).toContain('拟人化动物');
  });

  it('returns non-empty text for each call', async () => {
    const responses = ['human result', 'animal result', 'creature result', 'anthro result'];
    let callIdx = 0;
    mockCreate.mockImplementation(() =>
      Promise.resolve({ choices: [{ message: { content: responses[callIdx++] ?? '' } }] }),
    );
    const { generatePrompt } = await import('../index.js');
    const types = [undefined, '动物/宠物', '怪兽', '动物拟人'];
    for (const type of types) {
      const result = await generatePrompt('character', type ? { type } : { era: '现代' });
      expect(result.length).toBeGreaterThan(0);
    }
  });
});

describe('generatePrompt — scene and prop', () => {
  it('generates a scene prompt', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A photorealistic cinematic scene...' } }],
    });
    const { generatePrompt } = await import('../index.js');
    const result = await generatePrompt('scene', { name: '古城', era: '古代', scene_type: '室外' });
    expect(result.length).toBeGreaterThan(0);
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]?.content).toContain('场景');
  });

  it('generates a prop prompt', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'A product photography shot of a sword...' } }],
    });
    const { generatePrompt } = await import('../index.js');
    const result = await generatePrompt('prop', { name: '古剑', category: '武器' });
    expect(result.length).toBeGreaterThan(0);
    const call = mockCreate.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages[0]?.content).toContain('道具');
  });
});

describe('extractFields', () => {
  it('returns a CharacterDataSchema-shaped object for character kind', async () => {
    // era/genre are promoted columns (RF-1), not in CharacterDataSchema — exclude from mock
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              '{"type":"人类","gender":"男","age":"青年","persona":"侠客","body":"修长","features":"黑发利剑"}',
          },
        },
      ],
    });
    const { extractFields } = await import('../index.js');
    const result = await extractFields('character', '一名古代男侠客');
    expect(result).toMatchObject({
      type: '人类',
      gender: '男',
      age: '青年',
    });
  });

  it('handles markdown-fenced JSON from the model', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: '```json\n{"type":"人类","gender":"女","age":"青年","persona":"学生","body":"","features":""}\n```',
          },
        },
      ],
    });
    const { extractFields } = await import('../index.js');
    const result = await extractFields('character', '现代女学生');
    expect(result).toMatchObject({ type: '人类', gender: '女' });
  });

  it('returns a SceneData-shaped object for scene kind', async () => {
    // elements is z.array(z.string()) in SceneDataSchema
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"scene_type":"室外","mood":"清晨","elements":["城墙","石桥"],"prompt":"","description":"","title":""}',
          },
        },
      ],
    });
    const { extractFields } = await import('../index.js');
    const result = await extractFields('scene', '一座古代室外场景');
    expect(result).toMatchObject({ scene_type: '室外', mood: '清晨' });
  });
});

describe('AI error handling', () => {
  it('surfaces rate-limit as AiError with AI_RATE_LIMITED code', async () => {
    mockCreate.mockRejectedValue(new Error('429 rate limit exceeded'));
    const { generatePrompt, AiError } = await import('../index.js');
    await expect(generatePrompt('character', { era: '古代' })).rejects.toBeInstanceOf(AiError);
    await expect(generatePrompt('character', { era: '古代' })).rejects.toMatchObject({
      code: 'AI_RATE_LIMITED',
    });
  });

  it('surfaces quota error as AI_RATE_LIMITED', async () => {
    mockCreate.mockRejectedValue(new Error('402 insufficient quota'));
    const { generatePrompt, AiError } = await import('../index.js');
    await expect(generatePrompt('character', { era: '古代' })).rejects.toBeInstanceOf(AiError);
  });

  it('surfaces auth error as AI_AUTH_FAILED', async () => {
    mockCreate.mockRejectedValue(new Error('401 unauthorized api key'));
    const { generatePrompt, AiError } = await import('../index.js');
    await expect(generatePrompt('character', { era: '古代' })).rejects.toMatchObject({
      code: 'AI_AUTH_FAILED',
    });
  });

  it('surfaces AbortError (e.g. AbortSignal.timeout) as AI_NO_IMAGE with friendly text', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    mockCreate.mockRejectedValue(abortErr);
    const { generatePrompt, AiError } = await import('../index.js');
    await expect(generatePrompt('character', { era: '古代' })).rejects.toBeInstanceOf(AiError);
    await expect(generatePrompt('character', { era: '古代' })).rejects.toMatchObject({
      code: 'AI_NO_IMAGE',
      message: expect.stringContaining('中断'),
    });
  });

  it('surfaces TimeoutError as AI_NO_IMAGE with friendly text', async () => {
    const timeoutErr = new Error('Request timed out');
    timeoutErr.name = 'TimeoutError';
    mockCreate.mockRejectedValue(timeoutErr);
    const { generatePrompt } = await import('../index.js');
    await expect(generatePrompt('character', { era: '古代' })).rejects.toMatchObject({
      code: 'AI_NO_IMAGE',
    });
  });
});

describe('generateImage', () => {
  // A 1×1 transparent PNG is enough to assert the encoded data-URI prefix
  // without hitting the OpenRouter HTTP fallback path.
  const PNG_DATA_URI =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  function mockImageResponse(): void {
    mockCreate.mockResolvedValue({
      choices: [{ message: { images: [{ image_url: { url: PNG_DATA_URI } }] } }],
    });
  }

  function lastCallParams(): {
    model: string;
    messages: Array<{ role: 'user'; content: unknown }>;
    extra_body: { image_config: { aspect_ratio: string; image_size: string } };
  } {
    return mockCreate.mock.calls[0]?.[0] as {
      model: string;
      messages: Array<{ role: 'user'; content: unknown }>;
      extra_body: { image_config: { aspect_ratio: string; image_size: string } };
    };
  }

  it('sends the prompt as a plain string when no refs are provided', async () => {
    mockImageResponse();
    const { generateImage } = await import('../index.js');
    await generateImage('a winter forest');
    expect(lastCallParams().messages[0]?.content).toBe('a winter forest');
  });

  it('sends a content array with one image_url part when one ref is provided', async () => {
    mockImageResponse();
    const { generateImage } = await import('../index.js');
    await generateImage('change season', [Buffer.from('ref-bytes-1')]);
    const content = lastCallParams().messages[0]?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: 'text', text: 'change season' });
    expect(content[1]?.type).toBe('image_url');
    expect(content[1]?.image_url?.url).toBe(
      `data:image/png;base64,${Buffer.from('ref-bytes-1').toString('base64')}`,
    );
  });

  it('appends one image_url part per ref, in caller order', async () => {
    mockImageResponse();
    const { generateImage } = await import('../index.js');
    const refs = [Buffer.from('A'), Buffer.from('B'), Buffer.from('C')];
    await generateImage('compose', refs);
    const content = lastCallParams().messages[0]?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(content).toHaveLength(4); // 1 text + 3 images
    expect(content.slice(1).map((c) => c.image_url?.url)).toEqual(
      refs.map((b) => `data:image/png;base64,${b.toString('base64')}`),
    );
  });

  it('treats an empty refs array as no refs (plain string content)', async () => {
    mockImageResponse();
    const { generateImage } = await import('../index.js');
    await generateImage('text-only', []);
    expect(lastCallParams().messages[0]?.content).toBe('text-only');
  });

  it('uses env.IMAGE_ASPECT_RATIO when aspectRatio is omitted', async () => {
    mockImageResponse();
    const { generateImage } = await import('../index.js');
    await generateImage('any');
    expect(lastCallParams().extra_body.image_config.aspect_ratio).toBe('3:2');
  });

  it('passes the aspectRatio override through to image_config', async () => {
    mockImageResponse();
    const { generateImage } = await import('../index.js');
    await generateImage('any', undefined, '16:9');
    expect(lastCallParams().extra_body.image_config.aspect_ratio).toBe('16:9');
  });

  it('defaults the model to env.IMAGE_MODEL', async () => {
    mockImageResponse();
    const { generateImage } = await import('../index.js');
    await generateImage('any');
    expect(lastCallParams().model).toBe('openai/dall-e-3');
  });

  it('passes the model override through verbatim', async () => {
    mockImageResponse();
    const { generateImage } = await import('../index.js');
    await generateImage('any', undefined, undefined, 'openai/gpt-image-2');
    expect(lastCallParams().model).toBe('openai/gpt-image-2');
  });

  it('rejects empty prompts before calling the model', async () => {
    const { generateImage } = await import('../index.js');
    await expect(generateImage('   ')).rejects.toThrow('提示词为空');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('translates OpenRouter failures via translateError (401 → AI_AUTH_FAILED)', async () => {
    mockCreate.mockRejectedValue(new Error('401 unauthorized'));
    const { generateImage, AiError } = await import('../index.js');
    await expect(generateImage('any', [Buffer.from('x')])).rejects.toBeInstanceOf(AiError);
    await expect(generateImage('any', [Buffer.from('x')])).rejects.toMatchObject({
      code: 'AI_AUTH_FAILED',
    });
  });
});

describe('parseJson', () => {
  it('parses plain JSON', async () => {
    const { parseJson } = await import('../openrouter.js');
    expect(parseJson('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('extracts JSON from markdown fence', async () => {
    const { parseJson } = await import('../openrouter.js');
    expect(parseJson('```json\n{"key":"value"}\n```')).toEqual({ key: 'value' });
  });

  it('extracts JSON from surrounding text', async () => {
    const { parseJson } = await import('../openrouter.js');
    expect(parseJson('Here is the result: {"key":"value"} done.')).toEqual({ key: 'value' });
  });

  it('throws AiError for non-JSON text', async () => {
    const { parseJson, AiError } = await import('../openrouter.js');
    expect(() => parseJson('no json here')).toThrow(AiError);
  });
});
