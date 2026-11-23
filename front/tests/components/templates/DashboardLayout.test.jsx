import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardLayout } from '@/components/templates/DashboardLayout/DashboardLayout';

describe('DashboardLayout', () => {
  it('renders children', () => {
    render(<DashboardLayout><div>Main Content</div></DashboardLayout>);
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });

  it('renders stats section when provided', () => {
    render(<DashboardLayout stats={<div>Stats Area</div>}><div>Content</div></DashboardLayout>);
    expect(screen.getByText('Stats Area')).toBeInTheDocument();
  });

  it('renders sidebar when provided', () => {
    render(<DashboardLayout sidebar={<div>Sidebar</div>}><div>Content</div></DashboardLayout>);
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
  });

  it('renders without sidebar', () => {
    const { container } = render(<DashboardLayout><div>Content</div></DashboardLayout>);
    expect(container.querySelector('aside')).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(<DashboardLayout className="custom"><div>Content</div></DashboardLayout>);
    expect(container.firstChild).toHaveClass('custom');
  });
});
