/**
 * Regression test for the BEN-31 follow-up: clicking a thumbnail in the
 * drawer's image gallery must open the lightbox so the user can zoom in.
 * The lightbox renders via portal into document.body and surfaces a dialog
 * labelled "图片预览".
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LightboxProvider } from '@/components/ui/lightbox';
import { ImageGrid } from '../ImageGrid';

const IMAGES = [
  { id: 1, url: 'http://x/1', source: 'uploaded' },
  { id: 2, url: 'http://x/2', source: 'generated' },
];

function renderGrid(coverImageId: number | null = null) {
  return render(
    <LightboxProvider>
      <ImageGrid
        images={IMAGES}
        coverImageId={coverImageId}
        onSetCover={vi.fn()}
        onDelete={vi.fn()}
      />
    </LightboxProvider>,
  );
}

describe('ImageGrid', () => {
  it('opens the lightbox when a thumbnail is clicked', async () => {
    renderGrid();
    const user = userEvent.setup();

    expect(screen.queryByRole('dialog', { name: '图片预览' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '放大查看图像 1' }));

    expect(await screen.findByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
  });

  it('renders one zoom-in button per image (including the cover)', () => {
    renderGrid(1);
    expect(screen.getByRole('button', { name: '放大查看图像 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '放大查看图像 2' })).toBeInTheDocument();
  });
});
