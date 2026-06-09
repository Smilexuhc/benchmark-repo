/**
 * /playground page tests.
 *
 * Covers the v1 single-shot form contract:
 *  - Empty prompt disables the 生成图像 button.
 *  - Prompt-only submit sends no `refImages` to ai.generateStandalone.
 *  - Uploading a ref file walks getUploadUrl → fetch PUT → createStandalone and
 *    surfaces the thumbnail.
 *  - Submit with N uploaded refs sends the media ids in the user's add order.
 *  - "作为参考图继续修改" moves the result back into the ref-image list.
 *  - The MAX_REF_IMAGES (4) cap blocks a fifth upload at the UI layer.
 */
import { Toaster } from '@/components/feedback/toast';
import { createTrpcMock } from '@/test/trpc-mock';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type GenerateInput = {
  prompt: string;
  aspectRatio?: string;
  model?: string;
  refImages?: number[];
};
type UploadInput = { mediaType: string; filename: string; contentType: string };
type CreateInput = { objectKey: string; mediaType: 'image'; filename: string };

// Per-test capture buckets so each test can assert on the mutation inputs it
// triggered. Reset in beforeEach.
const captured = {
  uploadUrl: [] as UploadInput[],
  create: [] as CreateInput[],
  generate: [] as GenerateInput[],
  putRequests: [] as { url: string; body: BodyInit | null | undefined }[],
};

// Successive object keys so concurrent uploads don't collide in the test.
let objectKeyCounter = 0;
let mediaIdCounter = 1000;

// Controllable mock outcomes — tests flip these.
const mockState = {
  putShouldFail: false,
  generateShouldFail: false,
};

vi.mock('@/lib/trpc', () =>
  createTrpcMock({
    mutation: {
      'mediaAssets.getUploadUrl': async (input) => {
        captured.uploadUrl.push(input as UploadInput);
        objectKeyCounter += 1;
        return {
          uploadUrl: `https://example.com/upload/${objectKeyCounter}`,
          objectKey: `images/upload-${objectKeyCounter}.png`,
        };
      },
      'mediaAssets.createStandalone': async (input) => {
        captured.create.push(input as CreateInput);
        mediaIdCounter += 1;
        return {
          id: mediaIdCounter,
          assetId: null,
          objectKey: (input as CreateInput).objectKey,
          source: 'uploaded',
          mediaType: 'image',
          title: (input as CreateInput).filename,
          url: `https://cdn.example.com/${(input as CreateInput).objectKey}`,
          assetKind: null,
        };
      },
      'ai.generateStandalone': async (input) => {
        captured.generate.push(input as GenerateInput);
        if (mockState.generateShouldFail) {
          throw new Error('生成失败：接口不可达');
        }
        return {
          id: 9999,
          assetId: null,
          objectKey: 'images/generated.png',
          source: 'standalone-generated',
          mediaType: 'image',
          title: '',
          url: 'https://cdn.example.com/images/generated.png',
        };
      },
    },
  }),
);

import { PlaygroundPage } from '../PlaygroundPage';

beforeEach(() => {
  captured.uploadUrl = [];
  captured.create = [];
  captured.generate = [];
  captured.putRequests = [];
  objectKeyCounter = 0;
  mediaIdCounter = 1000;
  mockState.putShouldFail = false;
  mockState.generateShouldFail = false;

  // jsdom doesn't ship URL.createObjectURL / revokeObjectURL.
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
    URL.revokeObjectURL = vi.fn();
  } else {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  }

  // Mock global fetch for the PUT upload step.
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  globalThis.fetch = vi.fn(async (url: string, init: any) => {
    captured.putRequests.push({ url, body: init?.body });
    if (mockState.putShouldFail) {
      return { ok: false, status: 500 } as Response;
    }
    return { ok: true, status: 200 } as Response;
    // biome-ignore lint/suspicious/noExplicitAny: test stub
  }) as any;

  // jsdom doesn't ship clipboard either — silence the action.
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
  }
});

function makeFile(name = 'ref.png'): File {
  return new File(['ref-bytes'], name, { type: 'image/png' });
}

describe('PlaygroundPage', () => {
  it('disables 生成图像 when the prompt is empty', () => {
    render(<PlaygroundPage />);
    expect(screen.getByRole('button', { name: '生成图像' })).toBeDisabled();
  });

  it('submits with no refImages when no refs are uploaded', async () => {
    const user = userEvent.setup();
    render(<PlaygroundPage />);

    await user.type(screen.getByLabelText('提示词'), 'a winter forest');
    await user.click(screen.getByRole('button', { name: '生成图像' }));

    await waitFor(() => expect(captured.generate).toHaveLength(1));
    const call = captured.generate[0];
    expect(call?.prompt).toBe('a winter forest');
    expect(call?.aspectRatio).toBe('16:9');
    expect(call?.model).toBe('openai/gpt-5.4-image-2');
    expect(call?.refImages).toBeUndefined();
  });

  it('uploads a ref file via getUploadUrl → fetch PUT → createStandalone', async () => {
    const user = userEvent.setup();
    render(<PlaygroundPage />);

    // The hidden <input type=file> sits behind the "点击添加图像" button. We
    // upload directly to the input to skip the click-open-dialog ceremony.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    await user.upload(fileInput, makeFile('ref-1.png'));

    await waitFor(() => expect(captured.create).toHaveLength(1));
    expect(captured.uploadUrl[0]).toMatchObject({
      mediaType: 'image',
      filename: 'ref-1.png',
      contentType: 'image/png',
    });
    expect(captured.putRequests[0]?.url).toBe('https://example.com/upload/1');
    expect(captured.create[0]).toMatchObject({
      objectKey: 'images/upload-1.png',
      mediaType: 'image',
      filename: 'ref-1.png',
    });
  });

  it('sends uploaded mediaIds in caller add-order on submit', async () => {
    const user = userEvent.setup();
    render(<PlaygroundPage />);

    const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput(), makeFile('a.png'));
    await waitFor(() => expect(captured.create).toHaveLength(1));
    await user.upload(fileInput(), makeFile('b.png'));
    await waitFor(() => expect(captured.create).toHaveLength(2));

    await user.type(screen.getByLabelText('提示词'), 'compose');
    await user.click(screen.getByRole('button', { name: '生成图像' }));

    await waitFor(() => expect(captured.generate).toHaveLength(1));
    // The mock issues mediaIds 1001 then 1002 in upload order; the page must
    // preserve that order in the refImages array.
    expect(captured.generate[0]?.refImages).toEqual([1001, 1002]);
  });

  it('renders the result panel after a successful generation', async () => {
    const user = userEvent.setup();
    render(<PlaygroundPage />);
    await user.type(screen.getByLabelText('提示词'), 'something');
    await user.click(screen.getByRole('button', { name: '生成图像' }));

    expect(await screen.findByRole('button', { name: '下载' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制图片链接' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '作为参考图继续修改' })).toBeInTheDocument();
  });

  it('"作为参考图继续修改" pushes the result back into the ref list', async () => {
    const user = userEvent.setup();
    render(<PlaygroundPage />);
    await user.type(screen.getByLabelText('提示词'), 'something');
    await user.click(screen.getByRole('button', { name: '生成图像' }));

    const useAsRef = await screen.findByRole('button', { name: '作为参考图继续修改' });
    await user.click(useAsRef);

    // Result panel should disappear, and a new ref-image with the result url
    // should appear in the strip (with its remove button reachable on hover —
    // the button is present in DOM, just visually hidden).
    expect(screen.queryByRole('button', { name: '作为参考图继续修改' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '移除参考图' })).toHaveLength(1);

    // A follow-up generate now should include the result's mediaId.
    await user.click(screen.getByRole('button', { name: '生成图像' }));
    await waitFor(() => expect(captured.generate).toHaveLength(2));
    expect(captured.generate[1]?.refImages).toEqual([9999]);
  });

  it('caps ref-image uploads at MAX_REF_IMAGES (4)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <PlaygroundPage />
        <Toaster />
      </>,
    );

    const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
    for (let i = 0; i < 4; i++) {
      await user.upload(fileInput(), makeFile(`r-${i}.png`));
      await waitFor(() => expect(captured.create).toHaveLength(i + 1));
    }

    // The 5th add slot should be gone (the upload slot disappears once full).
    expect(screen.queryByRole('button', { name: '添加参考图' })).not.toBeInTheDocument();
  });

  it('surfaces upload failures by marking the thumbnail as 上传失败 and keeps the form usable', async () => {
    mockState.putShouldFail = true;
    const user = userEvent.setup();
    render(
      <>
        <PlaygroundPage />
        <Toaster />
      </>,
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(fileInput, makeFile('boom.png'));
    expect(await screen.findByText('上传失败')).toBeInTheDocument();
    expect(captured.create).toHaveLength(0);

    // Generate should still be reachable; the failed ref isn't included.
    await user.type(screen.getByLabelText('提示词'), 'fallback');
    await user.click(screen.getByRole('button', { name: '生成图像' }));
    await waitFor(() => expect(captured.generate).toHaveLength(1));
    expect(captured.generate[0]?.refImages).toBeUndefined();
  });
});
