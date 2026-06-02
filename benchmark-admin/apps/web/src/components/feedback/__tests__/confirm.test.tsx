import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmHost, __resetConfirmQueueForTests, confirm } from '../confirm';

describe('confirm() + ConfirmHost', () => {
  afterEach(() => {
    act(() => {
      __resetConfirmQueueForTests();
    });
  });

  it('resolves true when the user clicks the confirm button', async () => {
    render(<ConfirmHost />);
    const user = userEvent.setup();

    let result: boolean | null = null;
    act(() => {
      void confirm({ title: 'Delete item?' }).then((r) => {
        result = r;
      });
    });

    expect(await screen.findByRole('heading', { name: 'Delete item?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(result).toBe(true));
  });

  it('resolves false when the user clicks cancel', async () => {
    render(<ConfirmHost />);
    const user = userEvent.setup();

    let result: boolean | null = null;
    act(() => {
      void confirm({ title: 'Discard changes?' }).then((r) => {
        result = r;
      });
    });

    await screen.findByRole('heading', { name: 'Discard changes?' });
    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(result).toBe(false));
  });

  it('resolves false when the user presses Escape', async () => {
    render(<ConfirmHost />);
    const user = userEvent.setup();

    let result: boolean | null = null;
    act(() => {
      void confirm({ title: 'Sign out?' }).then((r) => {
        result = r;
      });
    });

    await screen.findByRole('heading', { name: 'Sign out?' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(result).toBe(false));
  });

  it('uses the destructive button variant when danger=true', async () => {
    render(<ConfirmHost />);

    act(() => {
      void confirm({ title: 'Delete permanently?', danger: true, confirmText: '删除' });
    });

    const button = await screen.findByRole('button', { name: '删除' });
    expect(button.className).toContain('destructive');
  });

  it('queues concurrent confirms instead of overlapping them', async () => {
    render(<ConfirmHost />);
    const user = userEvent.setup();

    let first: boolean | null = null;
    let second: boolean | null = null;

    act(() => {
      void confirm({ title: 'First?' }).then((r) => {
        first = r;
      });
      void confirm({ title: 'Second?' }).then((r) => {
        second = r;
      });
    });

    // Only the first confirm is rendered while the second waits in queue.
    await screen.findByRole('heading', { name: 'First?' });
    expect(screen.queryByRole('heading', { name: 'Second?' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(first).toBe(true));

    // After the first resolves, the second one takes its place.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Second?' })).toBeInTheDocument(),
    );
    expect(second).toBeNull();

    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(second).toBe(false));
  });

  it('traps focus inside the dialog when open and restores it on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    render(<ConfirmHost />);
    const user = userEvent.setup();

    act(() => {
      void confirm({ title: 'Focused?' });
    });

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    document.body.removeChild(trigger);
  });
});
