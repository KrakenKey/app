import { useRef, useState } from 'react';
import { MessageSquare, Check, Star } from 'lucide-react';
import api from '../services/api';
import { toast } from '../utils/toast';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Textarea } from './ui/Textarea';
import { PageHeader } from './ui/PageHeader';

export default function Feedback() {
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!message.trim()) {
      toast.error('Please enter a feedback message.');
      return;
    }
    if (rating === 0) {
      toast.error('Please select a rating.');
      return;
    }

    try {
      setSubmitting(true);
      await api.post('/feedback', { message: message.trim(), rating });
      toast.success('Thank you for your feedback!');
      setMessage('');
      setRating(0);
      setSubmitted(true);
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div>
        <PageHeader
          title="Feedback"
          icon={<MessageSquare className="w-6 h-6" />}
        />
        <Card className="border-emerald-500/20 bg-emerald-500/10 text-center">
          <Check className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
          <p className="text-emerald-400 font-medium">
            Thank you for your feedback!
          </p>
        </Card>
        <Button
          variant="primary"
          className="mt-4"
          onClick={() => setSubmitted(false)}
        >
          Submit Another
        </Button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Feedback"
        description="We would love to hear your thoughts. How are we doing?"
        icon={<MessageSquare className="w-6 h-6" />}
      />

      <Card className="max-w-2xl">
        <form onSubmit={handleSubmit}>
          <Textarea
            aria-label="Your feedback"
            placeholder="Tell us what you think..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={submitting}
            className="min-h-[100px]"
          />

          <div className="mt-5">
            <p
              id="feedback-rating-label"
              className="text-sm font-medium text-text-secondary mb-2"
            >
              Rating
            </p>
            <StarRating
              value={rating}
              onChange={setRating}
              disabled={submitting}
              labelledBy="feedback-rating-label"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={submitting}
            className="mt-5"
          >
            {submitting ? 'Submitting...' : 'Submit Feedback'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/**
 * Five-star rating as a radio group: click or hover with the mouse, or use
 * the arrow keys, Home and End once a star has focus.
 */
function StarRating({
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  labelledBy: string;
}) {
  const [hover, setHover] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = hover || value;

  const select = (next: number) => {
    const clamped = Math.min(5, Math.max(1, next));
    onChange(clamped);
    refs.current[clamped - 1]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, star: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        e.preventDefault();
        select(star + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        e.preventDefault();
        select(star - 1);
        break;
      case 'Home':
        e.preventDefault();
        select(1);
        break;
      case 'End':
        e.preventDefault();
        select(5);
        break;
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        className="flex items-center gap-0.5"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= shown;
          // Only one star is in the tab order: the selected one, else the first.
          const tabbable = value ? star === value : star === 1;
          return (
            <button
              key={star}
              ref={(el) => {
                refs.current[star - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={star === value}
              aria-label={`${star} star${star > 1 ? 's' : ''}, ${RATING_LABELS[star - 1]}`}
              tabIndex={tabbable ? 0 : -1}
              disabled={disabled}
              onClick={() => select(star)}
              onMouseEnter={() => setHover(star)}
              onKeyDown={(e) => onKeyDown(e, star)}
              className="group rounded-md p-1 cursor-pointer transition-transform duration-100 hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              <Star
                aria-hidden="true"
                strokeWidth={1.75}
                className={`w-7 h-7 transition-colors duration-100 ${
                  filled
                    ? 'fill-amber-400 text-amber-400'
                    : 'fill-transparent text-zinc-600 group-hover:text-zinc-400'
                }`}
              />
            </button>
          );
        })}
      </div>
      <span className="text-sm text-text-muted min-w-20" aria-hidden="true">
        {shown ? RATING_LABELS[shown - 1] : ''}
      </span>
    </div>
  );
}
