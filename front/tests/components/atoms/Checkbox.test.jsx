import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from '@/components/atoms/Checkbox/Checkbox';

describe('Checkbox', () => {
  it('renders with label', () => {
    render(<Checkbox label="Hide Archived" checked={false} onChange={() => {}} />);
    expect(screen.getByText('Hide Archived')).toBeInTheDocument();
  });

  it('renders checked state', () => {
    render(<Checkbox label="Active" checked={true} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('renders unchecked state', () => {
    render(<Checkbox label="Active" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('calls onChange when clicked', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Toggle" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalled();
  });

  it('applies custom className', () => {
    const { container } = render(
      <Checkbox label="Test" checked={false} onChange={() => {}} className="custom" />
    );
    expect(container.querySelector('label')).toHaveClass('custom');
  });
});
