import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchInput } from '@/components/molecules/SearchInput/SearchInput';

describe('SearchInput', () => {
  it('renders with default placeholder', () => {
    render(<SearchInput value="" onChange={() => {}} />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('renders with custom placeholder', () => {
    render(<SearchInput value="" onChange={() => {}} placeholder="Search repos..." />);
    expect(screen.getByPlaceholderText('Search repos...')).toBeInTheDocument();
  });

  it('displays current value', () => {
    render(<SearchInput value="react" onChange={() => {}} />);
    expect(screen.getByDisplayValue('react')).toBeInTheDocument();
  });

  it('calls onChange when typing', () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'test' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('applies custom className', () => {
    const { container } = render(<SearchInput value="" onChange={() => {}} className="w-full" />);
    expect(container.firstChild).toHaveClass('w-full');
  });
});
