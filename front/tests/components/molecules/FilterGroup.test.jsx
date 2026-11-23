import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilterGroup } from '@/components/molecules/FilterGroup/FilterGroup';

describe('FilterGroup', () => {
  it('renders label and children', () => {
    render(
      <FilterGroup label="Status">
        <select data-testid="select"><option>All</option></select>
      </FilterGroup>
    );
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByTestId('select')).toBeInTheDocument();
  });

  it('renders without label', () => {
    render(
      <FilterGroup>
        <span>Content</span>
      </FilterGroup>
    );
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <FilterGroup label="Test" className="custom-class">
        <span>Child</span>
      </FilterGroup>
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
