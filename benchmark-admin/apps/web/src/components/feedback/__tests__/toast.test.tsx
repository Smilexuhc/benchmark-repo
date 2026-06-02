import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Toaster, toast } from '../toast';

function mountToaster() {
  return render(<Toaster />);
}

describe('Toaster + toast', () => {
  afterEach(() => {
    // Drop any toast that the previous test left mounted so timers/queries
    // don't bleed across cases.
    act(() => {
      toast.dismiss();
    });
  });

  it('renders a success toast that includes the message', async () => {
    mountToaster();
    act(() => {
      toast.success('Saved successfully');
    });
    expect(await screen.findByText('Saved successfully')).toBeInTheDocument();
  });

  it('renders an info toast', async () => {
    mountToaster();
    act(() => {
      toast.info('Heads up');
    });
    expect(await screen.findByText('Heads up')).toBeInTheDocument();
  });

  it('renders a warning toast', async () => {
    mountToaster();
    act(() => {
      toast.warning('Be careful');
    });
    expect(await screen.findByText('Be careful')).toBeInTheDocument();
  });

  it('error toasts populate a role="alert" live region for assistive tech', async () => {
    mountToaster();
    act(() => {
      toast.error('Something broke');
    });

    const alert = await screen.findByRole('alert');
    await waitFor(() => {
      expect(alert.textContent).toContain('Something broke');
    });
    // The visible toast is also mounted alongside the live-region announcement;
    // both contain the message text so we expect two matches.
    const matches = await screen.findAllByText('Something broke');
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('auto-dismisses toasts after the default duration', async () => {
    mountToaster();
    act(() => {
      toast.success('Goes away', { duration: 100 });
    });
    expect(await screen.findByText('Goes away')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.queryByText('Goes away')).toBeNull();
      },
      { timeout: 4000 },
    );
  });
});
