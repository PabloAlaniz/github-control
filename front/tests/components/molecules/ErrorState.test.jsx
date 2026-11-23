import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from '@/components/molecules/ErrorState/ErrorState';

describe('ErrorState', () => {
  describe('page variant (default)', () => {
    it('renders title and message', () => {
      render(<ErrorState message="Network error" />);
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    it('renders custom title', () => {
      render(<ErrorState message="Oops" title="Custom Error" />);
      expect(screen.getByText('Custom Error')).toBeInTheDocument();
    });

    it('renders retry button when onRetry is provided', () => {
      const onRetry = vi.fn();
      render(<ErrorState message="Error" onRetry={onRetry} />);
      fireEvent.click(screen.getByText('Try Again'));
      expect(onRetry).toHaveBeenCalled();
    });

    it('renders custom retry label', () => {
      render(<ErrorState message="Error" onRetry={() => {}} retryLabel="Reload" />);
      expect(screen.getByText('Reload')).toBeInTheDocument();
    });

    it('does not render retry button when onRetry is not provided', () => {
      render(<ErrorState message="Error" />);
      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
    });
  });

  describe('banner variant', () => {
    it('renders message in banner style', () => {
      render(<ErrorState message="Banner error" variant="banner" />);
      expect(screen.getByText('Banner error')).toBeInTheDocument();
    });

    it('does not render title or retry button', () => {
      render(<ErrorState message="Banner" variant="banner" onRetry={() => {}} />);
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
    });
  });

  describe('inline variant', () => {
    it('renders message inline', () => {
      render(<ErrorState message="Inline error" variant="inline" />);
      expect(screen.getByText('Inline error')).toBeInTheDocument();
    });

    it('does not render title or retry button', () => {
      render(<ErrorState message="Inline" variant="inline" onRetry={() => {}} />);
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
    });
  });

  it('applies custom className', () => {
    const { container } = render(<ErrorState message="Error" className="custom" />);
    expect(container.firstChild).toHaveClass('custom');
  });
});
