import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewSwitcher } from '@/components/molecules/ViewSwitcher/ViewSwitcher';

describe('ViewSwitcher', () => {
  it('renders repos and services buttons', () => {
    render(<ViewSwitcher activeView="repos" onViewChange={() => {}} />);
    expect(screen.getByText('Repos')).toBeInTheDocument();
    expect(screen.getByText('Services')).toBeInTheDocument();
  });

  it('highlights active view', () => {
    render(<ViewSwitcher activeView="repos" onViewChange={() => {}} />);
    const reposBtn = screen.getByText('Repos').closest('button');
    expect(reposBtn).toHaveClass('bg-white');
  });

  it('calls onViewChange when clicking a view', () => {
    const onViewChange = vi.fn();
    render(<ViewSwitcher activeView="repos" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByText('Services'));
    expect(onViewChange).toHaveBeenCalledWith('services');
  });

  it('applies custom className', () => {
    const { container } = render(<ViewSwitcher activeView="repos" onViewChange={() => {}} className="my-class" />);
    expect(container.firstChild).toHaveClass('my-class');
  });
});
