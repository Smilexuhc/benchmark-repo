import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LazyImage } from '../LazyImage';

describe('LazyImage', () => {
  it('renders the image when src is provided', () => {
    render(<LazyImage src="https://cdn.example.com/a.png" alt="hero" />);
    expect(screen.getByRole('img', { name: 'hero' })).toBeInTheDocument();
  });

  it('shows the no-image placeholder when src is empty', () => {
    render(<LazyImage src={null} alt="hero" />);
    expect(screen.getByText('无图')).toBeInTheDocument();
  });

  it('falls back to "无图" when the underlying image errors', () => {
    render(<LazyImage src="https://cdn.example.com/a.png" alt="hero" />);
    const img = screen.getByRole('img', { name: 'hero' });
    fireEvent.error(img);
    expect(screen.getByText('无图')).toBeInTheDocument();
  });

  it('resets the error latch when src changes (fresh URL retries)', () => {
    const { rerender } = render(<LazyImage src="https://cdn.example.com/a.png" alt="hero" />);
    fireEvent.error(screen.getByRole('img', { name: 'hero' }));
    expect(screen.getByText('无图')).toBeInTheDocument();

    // A refetch hands us a fresh presigned URL — the latch must clear so the
    // user sees the image instead of being permanently stuck on the placeholder.
    rerender(<LazyImage src="https://cdn.example.com/a.png?sig=2" alt="hero" />);
    expect(screen.getByRole('img', { name: 'hero' })).toBeInTheDocument();
    expect(screen.queryByText('无图')).toBeNull();
  });
});
