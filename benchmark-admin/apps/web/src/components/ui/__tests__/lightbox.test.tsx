import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LightboxProvider } from '@/components/ui/lightbox';
import {
  type LightboxImage,
  type LightboxOpenOptions,
  useLightbox,
} from '@/lib/lightbox-context';

type TriggerProps = {
  openOptions: () => LightboxOpenOptions;
  label?: string;
};

function Trigger({ openOptions, label = '打开' }: TriggerProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { open } = useLightbox();
  return (
    <button
      type="button"
      ref={ref}
      onClick={() => open({ ...openOptions(), triggerRef: ref })}
    >
      {label}
    </button>
  );
}

const IMAGES_3: LightboxImage[] = [
  { id: 1, url: 'https://cdn.example.com/a.png' },
  { id: 2, url: 'https://cdn.example.com/b.png', isCover: true },
  { id: 3, url: 'https://cdn.example.com/c.png' },
];

describe('Lightbox', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows counter and clamps next at the last image', async () => {
    const user = userEvent.setup();
    render(
      <LightboxProvider>
        <Trigger openOptions={() => ({ images: IMAGES_3, initialIndex: 0 })} />
      </LightboxProvider>,
    );

    await user.click(screen.getByRole('button', { name: '打开' }));
    expect(screen.getByLabelText('counter')).toHaveTextContent('1/3');

    await user.click(screen.getByRole('button', { name: '下一张' }));
    expect(screen.getByLabelText('counter')).toHaveTextContent('2/3');

    await user.click(screen.getByRole('button', { name: '下一张' }));
    expect(screen.getByLabelText('counter')).toHaveTextContent('3/3');

    // wraparound stops at last — clicking next at 3/3 stays at 3/3
    expect(screen.getByRole('button', { name: '下一张' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '下一张' }));
    expect(screen.getByLabelText('counter')).toHaveTextContent('3/3');

    // prev also clamps at 1/3
    await user.click(screen.getByRole('button', { name: '上一张' }));
    await user.click(screen.getByRole('button', { name: '上一张' }));
    expect(screen.getByLabelText('counter')).toHaveTextContent('1/3');
    expect(screen.getByRole('button', { name: '上一张' })).toBeDisabled();
  });

  it('fires onSetCover with the current imageId and moves the badge', async () => {
    const user = userEvent.setup();
    const onSetCover = vi.fn();
    render(
      <LightboxProvider>
        <Trigger
          openOptions={() => ({ images: IMAGES_3, initialIndex: 0, onSetCover })}
        />
      </LightboxProvider>,
    );

    await user.click(screen.getByRole('button', { name: '打开' }));

    // image 1 is not the cover — "设为默认图" is visible
    await user.click(screen.getByRole('button', { name: '设为默认图' }));
    expect(onSetCover).toHaveBeenCalledWith(1);
    // badge now sits on image 1
    expect(screen.getByText('当前默认图')).toBeInTheDocument();

    // move to image 2 — badge stays on image 1, so "设为默认图" reappears for image 2
    await user.click(screen.getByRole('button', { name: '下一张' }));
    expect(screen.getByRole('button', { name: '设为默认图' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '设为默认图' }));
    expect(onSetCover).toHaveBeenLastCalledWith(2);
    expect(screen.getByText('当前默认图')).toBeInTheDocument();
  });

  it('hides 设为默认图 when onSetCover is omitted', async () => {
    const user = userEvent.setup();
    render(
      <LightboxProvider>
        <Trigger openOptions={() => ({ images: IMAGES_3, initialIndex: 1 })} />
      </LightboxProvider>,
    );
    await user.click(screen.getByRole('button', { name: '打开' }));
    expect(screen.queryByRole('button', { name: '设为默认图' })).toBeNull();
    expect(screen.queryByText('当前默认图')).toBeNull();
  });

  it('closes on ESC and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <LightboxProvider>
        <Trigger openOptions={() => ({ images: IMAGES_3 })} />
      </LightboxProvider>,
    );
    const trigger = screen.getByRole('button', { name: '打开' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes on backdrop click and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <LightboxProvider>
        <Trigger openOptions={() => ({ images: IMAGES_3 })} />
      </LightboxProvider>,
    );
    const trigger = screen.getByRole('button', { name: '打开' });
    await user.click(trigger);

    await user.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it('restores scroll position of the nearest scrollable ancestor on close', async () => {
    const user = userEvent.setup();

    // Trigger sits inside a virtual-list-style scrollable container; opening the
    // lightbox could shift other content (e.g. a fixed header showing). On close
    // the ancestor's scrollTop must adjust so the trigger lands back where the
    // user left it.
    function ScrollableHost() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      const { open } = useLightbox();
      return (
        <div data-testid="scroll-ancestor" style={{ overflowY: 'scroll', height: 200 }}>
          <button
            type="button"
            ref={triggerRef}
            onClick={() => open({ images: IMAGES_3, triggerRef })}
          >
            打开
          </button>
        </div>
      );
    }

    render(
      <LightboxProvider>
        <ScrollableHost />
      </LightboxProvider>,
    );

    const ancestor = screen.getByTestId('scroll-ancestor');
    // Force the ancestor to look scrollable to findScrollableAncestor.
    Object.defineProperty(ancestor, 'scrollHeight', { configurable: true, value: 5000 });
    Object.defineProperty(ancestor, 'clientHeight', { configurable: true, value: 200 });
    ancestor.scrollTop = 1000;

    const trigger = screen.getByRole('button', { name: '打开' });

    // Pretend the trigger was at viewport top:50 when opened.
    const rectAtOpen = { top: 50, left: 0, bottom: 70, right: 100, width: 100, height: 20 };
    const rectAtClose = { top: 200, left: 0, bottom: 220, right: 100, width: 100, height: 20 };
    const rectSpy = vi.spyOn(trigger, 'getBoundingClientRect');
    rectSpy.mockReturnValueOnce(rectAtOpen as DOMRect);
    rectSpy.mockReturnValueOnce(rectAtClose as DOMRect);

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '关闭预览' }));

    // delta = rectAtClose.top - rectAtOpen.top = 150 → scrollTop should grow by 150
    await vi.waitFor(() => expect(ancestor.scrollTop).toBe(1150));
  });

  it('throws a clear error when useLightbox is called outside the provider', () => {
    function Inner() {
      useLightbox();
      return null;
    }
    // suppress React's noisy error boundary log for this assertion
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Inner />)).toThrow(/LightboxProvider/);
    consoleError.mockRestore();
  });
});
