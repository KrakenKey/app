import { useState } from 'react';
import { MessageSquare, Check } from 'lucide-react';
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
          <p className="text-emerald-400 font-medium">Thank you for your feedback!</p>
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

      <Card>
        <form onSubmit={handleSubmit}>
          <Textarea
            placeholder="Tell us what you think..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={submitting}
            className="min-h-[100px]"
          />

          <div className="mt-4">
            <p className="text-sm font-medium text-zinc-300 mb-2">Rating</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`text-2xl p-0.5 transition-colors cursor-pointer bg-transparent border-none ${
                    star <= rating ? 'text-amber-400' : 'text-zinc-600'
                  } hover:text-amber-400 disabled:cursor-not-allowed disabled:opacity-50`}
                  onClick={() => setRating(star)}
                  disabled={submitting}
                  aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <Button type="submit" variant="primary" disabled={submitting} className="mt-4">
            {submitting ? 'Submitting...' : 'Submit Feedback'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
