import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityBadge, actorColor } from '@/components/atoms/ActivityBadge/ActivityBadge';

describe('ActivityBadge', () => {
  it('renders the actor name for agents and humans', () => {
    render(<ActivityBadge actorType="agent" actorName="release-bot" />);
    render(<ActivityBadge actorType="human" actorName="alice" />);
    expect(screen.getByText('release-bot')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('gives each agent a stable color of its own', () => {
    expect(actorColor('agent', 'release-bot')).toBe(actorColor('agent', 'Release-Bot'));
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((name) => actorColor('agent', name)));
    expect(colors.size).toBeGreaterThan(3);

    const { container } = render(<ActivityBadge actorType="agent" actorName="release-bot" />);
    expect(container.firstChild.className).toContain(actorColor('agent', 'release-bot').split(' ')[0]);
  });

  it('uses the neutral color for humans', () => {
    const { container } = render(<ActivityBadge actorType="human" actorName="alice" />);
    expect(container.firstChild).toHaveClass('bg-gray-100');
  });

  it('falls back to unknown color for unrecognized type', () => {
    const { container } = render(<ActivityBadge actorType="system" actorName="cron" />);
    expect(container.firstChild).toHaveClass('bg-gray-50');
  });

  it('displays actorType when actorName is missing', () => {
    render(<ActivityBadge actorType="agent" actorName="" />);
    expect(screen.getByText('agent')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<ActivityBadge actorType="agent" actorName="Test" className="custom" />);
    expect(container.firstChild).toHaveClass('custom');
  });
});
