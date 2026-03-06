import { useState } from 'react';
import api from '../services/api';
import { toast } from '../utils/toast';
import './Feedback.css';

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
      <div className="feedback-section">
        <h2>Feedback</h2>
        <div className="feedback-success">
          <p>Thank you for your feedback!</p>
        </div>
        <button
          className="btn-primary submit-another"
          onClick={() => setSubmitted(false)}
        >
          Submit Another
        </button>
      </div>
    );
  }

  return (
    <div className="feedback-section">
      <h2>Feedback</h2>
      <p className="subtitle">
        We would love to hear your thoughts. How are we doing?
      </p>

      <div className="feedback-form-container">
        <form onSubmit={handleSubmit}>
          <div>
            <textarea
              className="feedback-textarea"
              placeholder="Tell us what you think..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div>
            <p className="star-rating-label">Rating</p>
            <div className="star-rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`star-btn ${star <= rating ? 'active' : ''}`}
                  onClick={() => setRating(star)}
                  disabled={submitting}
                  aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </form>
      </div>
    </div>
  );
}
