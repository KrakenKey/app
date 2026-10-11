import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Feedback from '../Feedback';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { post: vi.fn() },
}));
vi.mock('../../services/api', () => ({ default: mockApi }));
vi.mock('../../utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('Feedback', () => {
  beforeEach(() => {
    mockApi.post.mockReset();
    mockApi.post.mockResolvedValue({ data: {} });
  });

  it('renders the rating as a radio group of five stars', () => {
    render(<Feedback />);
    const group = screen.getByRole('radiogroup', { name: 'Rating' });
    const stars = screen.getAllByRole('radio');
    expect(group).toBeInTheDocument();
    expect(stars).toHaveLength(5);
    expect(stars.every((s) => s.getAttribute('aria-checked') === 'false')).toBe(
      true,
    );
    // Only the first star is in the tab order until one is picked
    expect(stars.map((s) => s.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(screen.queryByText('★')).not.toBeInTheDocument();
  });

  it('supports the keyboard and submits the chosen rating', async () => {
    const user = userEvent.setup();
    render(<Feedback />);

    await user.type(screen.getByLabelText('Your feedback'), 'Nice work');
    await user.tab();
    expect(screen.getByRole('radio', { name: /^1 star,/ })).toHaveFocus();

    await user.keyboard('{End}');
    const five = screen.getByRole('radio', { name: /^5 stars/ });
    expect(five).toHaveAttribute('aria-checked', 'true');
    expect(five).toHaveFocus();

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    const three = screen.getByRole('radio', { name: /^3 stars, Good/ });
    expect(three).toHaveAttribute('aria-checked', 'true');
    expect(three.tabIndex).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Submit Feedback' }));
    expect(mockApi.post).toHaveBeenCalledWith('/feedback', {
      message: 'Nice work',
      rating: 3,
    });
  });

  it('sets the rating with a click', async () => {
    const user = userEvent.setup();
    render(<Feedback />);
    await user.click(screen.getByRole('radio', { name: /^4 stars/ }));
    expect(screen.getByRole('radio', { name: /^4 stars/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
