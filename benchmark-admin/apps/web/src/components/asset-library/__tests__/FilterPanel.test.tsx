import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type FilterField, FilterPanel } from '../FilterPanel';
import type { AssetFilters } from '../useFilters';

const EMPTY_FILTERS: AssetFilters = {
  era: [],
  genre: [],
  type: [],
  gender: [],
  age: [],
  scene_type: [],
  mood: [],
  category: [],
};

const FIELDS: FilterField[] = [
  { key: 'era', label: '时代', options: ['古代', '现代'] },
  { key: 'genre', label: '题材', options: ['古风', '科幻'] },
];

function setup(partial: Partial<Parameters<typeof FilterPanel>[0]> = {}) {
  const onFilterChange = vi.fn();
  const onDeletedOnlyChange = vi.fn();
  const onReset = vi.fn();
  const view = render(
    <FilterPanel
      fields={FIELDS}
      filters={EMPTY_FILTERS}
      deletedOnly={false}
      hitCount={42}
      activeFilterCount={0}
      onFilterChange={onFilterChange}
      onDeletedOnlyChange={onDeletedOnlyChange}
      onReset={onReset}
      {...partial}
    />,
  );
  return { ...view, onFilterChange, onDeletedOnlyChange, onReset };
}

describe('FilterPanel', () => {
  it('renders one checkbox per option, each tied to its label', () => {
    setup();
    const checkbox = screen.getByRole('checkbox', { name: '古代' });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
  });

  it('toggles a filter via checkbox click', async () => {
    const { onFilterChange } = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: '古代' }));
    expect(onFilterChange).toHaveBeenCalledWith('era', ['古代']);
  });

  it('shows 重置 (N) with the active count', () => {
    setup({
      filters: { ...EMPTY_FILTERS, era: ['古代', '现代'], genre: ['古风'] },
      activeFilterCount: 3,
    });
    expect(screen.getByRole('button', { name: /重置 \(3\)/ })).toBeEnabled();
  });

  it('disables 重置 when no filters are active', () => {
    setup({ activeFilterCount: 0 });
    expect(screen.getByRole('button', { name: /重置 \(0\)/ })).toBeDisabled();
  });

  it('reflects current list size via 命中 N 个', () => {
    setup({ hitCount: 7 });
    expect(screen.getByText('命中 7 个')).toBeInTheDocument();
  });

  it('toggles 显示已删除 via the bottom checkbox', async () => {
    const { onDeletedOnlyChange } = setup();
    await userEvent.click(screen.getByRole('checkbox', { name: '显示已删除' }));
    expect(onDeletedOnlyChange).toHaveBeenCalledWith(true);
  });
});
