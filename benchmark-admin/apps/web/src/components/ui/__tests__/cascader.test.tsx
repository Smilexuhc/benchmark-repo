import type { CategoryOption } from '@benchmark-admin/shared/benchmark/categoryTree';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Cascader, type CascaderProps } from '../cascader';
import { buildCascaderOptionsWithCounts } from '../cascader.helpers';

const TREE: CategoryOption[] = [
  {
    value: 'a',
    label: 'A',
    children: [
      {
        value: 'a1',
        label: 'A1',
        children: [
          { value: 'a1x', label: 'A1x' },
          { value: 'a1y', label: 'A1y' },
        ],
      },
      { value: 'a2', label: 'A2', children: [{ value: 'a2x', label: 'A2x' }] },
    ],
  },
  {
    value: 'b',
    label: 'B',
    children: [{ value: 'b1', label: 'B1', children: [{ value: 'b1x', label: 'B1x' }] }],
  },
];

function Harness(props: Partial<CascaderProps> & { initial?: string[] }) {
  const [value, setValue] = useState<string[]>(props.initial ?? []);
  return (
    <Cascader
      options={props.options ?? TREE}
      value={value}
      onChange={(path, labels, leaf) => {
        setValue(path);
        props.onChange?.(path, labels, leaf);
      }}
      ariaLabel="cat"
    />
  );
}

describe('Cascader', () => {
  it('commits a leaf and shows the path on the trigger', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'cat' }));
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.click(await screen.findByRole('option', { name: 'A1' }));
    await user.click(await screen.findByRole('option', { name: 'A1x' }));

    expect(onChange).toHaveBeenCalledWith(
      ['a', 'a1', 'a1x'],
      ['A', 'A1', 'A1x'],
      expect.objectContaining({ value: 'a1x' }),
    );
    // Popover closed.
    expect(screen.queryByRole('option', { name: 'A' })).toBeNull();
    // Trigger now shows the path.
    expect(screen.getByRole('button', { name: 'cat' })).toHaveTextContent('A / A1 / A1x');
  });

  it('hovering an interior node reveals its children column', async () => {
    render(<Harness initial={['a', 'a1']} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'cat' }));

    // L3 column visible because initial value walks all the way to 'a1'.
    expect(await screen.findByRole('option', { name: 'A1x' })).toBeInTheDocument();

    // Hover A2 → L3 column should swap to A2's children.
    await user.hover(screen.getByRole('option', { name: 'A2' }));
    expect(await screen.findByRole('option', { name: 'A2x' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'A1x' })).toBeNull();
  });

  it('renders per-node counts when options come from buildCascaderOptionsWithCounts', async () => {
    const decorated = buildCascaderOptionsWithCounts(TREE, [
      { categoryL1: 'a', categoryL2: 'a1', categoryL3: 'a1x', count: 3 },
      { categoryL1: 'a', categoryL2: 'a1', categoryL3: 'a1y', count: 2 },
      { categoryL1: 'a', categoryL2: 'a2', categoryL3: 'a2x', count: 1 },
    ]);

    render(<Harness options={decorated} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'cat' }));

    // L1 aggregates everything under A → 6.
    expect(await screen.findByRole('option', { name: 'A (6)' })).toBeInTheDocument();
    // B has no counts.
    expect(screen.getByRole('option', { name: 'B (0)' })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'A (6)' }));
    expect(await screen.findByRole('option', { name: 'A1 (5)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'A2 (1)' })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'A1 (5)' }));
    expect(await screen.findByRole('option', { name: 'A1x (3)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'A1y (2)' })).toBeInTheDocument();
  });

  it('supports keyboard navigation: arrows + Enter commit a leaf', async () => {
    const onChange = vi.fn();
    render(<Harness initial={['a', 'a1', 'a1x']} onChange={onChange} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'cat' }));
    // Initial focus lands on the deepest active row (A1x).
    const a1x = await screen.findByRole('option', { name: 'A1x' });
    expect(a1x).toHaveFocus();

    // Move down to A1y, then commit.
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(
      ['a', 'a1', 'a1y'],
      ['A', 'A1', 'A1y'],
      expect.objectContaining({ value: 'a1y' }),
    );
  });
});
