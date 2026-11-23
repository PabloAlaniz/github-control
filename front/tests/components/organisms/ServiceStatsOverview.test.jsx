import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServiceStatsOverview } from '@/components/organisms/ServiceStatsOverview/ServiceStatsOverview';

describe('ServiceStatsOverview', () => {
  const mockServices = [
    { slug: 's1', lastCheckStatus: 'healthy' },
    { slug: 's2', lastCheckStatus: 'healthy' },
    { slug: 's3', lastCheckStatus: 'degraded' },
    { slug: 's4', lastCheckStatus: 'down' },
    { slug: 's5', lastCheckStatus: null },
  ];

  it('renders total count', () => {
    render(<ServiceStatsOverview services={mockServices} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('renders healthy count', () => {
    render(<ServiceStatsOverview services={mockServices} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders degraded count', () => {
    render(<ServiceStatsOverview services={mockServices} />);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('renders down count', () => {
    render(<ServiceStatsOverview services={mockServices} />);
    expect(screen.getByText('Down')).toBeInTheDocument();
  });

  it('handles empty services', () => {
    render(<ServiceStatsOverview services={[]} />);
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBe(4);
  });
});
