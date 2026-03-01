# Error Handling Implementation

## Overview

We've implemented comprehensive error handling across the frontend and backend to provide better user feedback and developer experience.

## What We Built

### Frontend

1. **Toast Notification System** ([toast.ts](../frontend/src/utils/toast.ts))
   - Lightweight, no external dependencies
   - 4 types: success, error, info, warning
   - Auto-dismiss with configurable duration
   - Slide-in/slide-out animations

2. **API Response Interceptor** ([api.ts](../frontend/src/services/api.ts))
   - Catches all API errors globally
   - Shows user-friendly toast notifications
   - Handles specific status codes:
     - **401**: Session expired → Clear auth → Redirect to login
     - **403**: Permission denied
     - **404**: Resource not found
     - **422**: Validation errors (shows each error)
     - **429**: Rate limit exceeded
     - **500**: Server error
     - **Network errors**: Connection issues

### Backend

1. **Global Exception Filter** ([http-exception.filter.ts](../backend/src/filters/http-exception.filter.ts))
   - Catches all exceptions globally
   - Formats errors consistently:
     ```json
     {
       "statusCode": 404,
       "message": "Resource not found",
       "error": "Not Found",
       "timestamp": "2024-01-01T00:00:00.000Z",
       "path": "/api/endpoint"
     }
     ```
   - Logs errors with appropriate levels (warn for 4xx, error for 5xx)

2. **Request Logging** (Development only)
   - Logs all incoming requests: `GET /api/users`
   - Helps with debugging API calls

## Usage

### Frontend - Using Toast Notifications

```typescript
import { toast } from '../utils/toast';

// Success message
toast.success('Domain verified successfully!');

// Error message
toast.error('Failed to delete domain');

// Info message
toast.info('Certificate is being processed...');

// Warning message
toast.warning('This action cannot be undone');

// With custom duration (milliseconds)
toast.success('Saved!', 2000);
```

### Frontend - API Calls

Errors are handled automatically by the interceptor, so you can write clean code:

```typescript
try {
  const response = await api.post('/domains', { hostname: 'example.com' });
  toast.success('Domain added!');
  // Handle success...
} catch (error) {
  // Error toast is already shown by interceptor
  // Just handle component-specific logic here
}
```

### Backend - Throwing Errors

Use NestJS built-in exceptions for consistent error responses:

```typescript
import { NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';

// 404 Not Found
throw new NotFoundException('Domain not found');

// 400 Bad Request
throw new BadRequestException('Invalid hostname format');

// 401 Unauthorized
throw new UnauthorizedException('Invalid credentials');

// 422 Validation Error (handled by ValidationPipe)
// Just use DTOs with class-validator decorators
```

## Testing

### Quick Test with Demo Component

Add the demo component to your Dashboard to test error handling:

```typescript
// In Dashboard.tsx
import ErrorHandlingDemo from '../components/ErrorHandlingDemo';

function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <ErrorHandlingDemo />
      {/* Rest of your dashboard */}
    </div>
  );
}
```

### Manual Testing

1. **Test 401 (Session Expired)**:
   - Delete your `access_token` from localStorage
   - Try to access an authenticated endpoint
   - Should see toast and redirect to login

2. **Test 404 (Not Found)**:
   - Try to access a non-existent endpoint
   - Should see "Resource not found" toast

3. **Test Validation Errors**:
   - Submit invalid data to an endpoint with DTOs
   - Should see validation error toasts

4. **Test Network Errors**:
   - Stop your backend server
   - Try any API call
   - Should see "Network error" toast

## Error Flow Diagram

```
┌─────────────────┐
│  User Action    │
│  (Button Click) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  API Call       │
│  api.post(...)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Request Interceptor                │
│  • Add Authorization header         │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Backend API                        │
│  • ValidationPipe checks DTOs       │
│  • Service processes request        │
│  • HttpExceptionFilter catches      │
│    errors and formats response      │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Response Interceptor               │
│  • Success: Pass through            │
│  • Error: Show toast + handle auth  │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  User sees      │
│  Toast message  │
└─────────────────┘
```

## Benefits for MVP

1. **Better User Experience**: Users see clear error messages instead of silent failures
2. **Faster Debugging**: Console logs + request logging help identify issues quickly
3. **Consistent API**: All endpoints return errors in the same format
4. **Auto-Auth Handling**: 401 errors automatically clear auth and redirect
5. **No External Dependencies**: Toast system is custom-built, no library bloat

## Future Improvements (Post-MVP)

- [ ] Add error tracking service (Sentry, Rollbar, etc.)
- [ ] Add retry logic for failed requests
- [ ] Add offline detection and queuing
- [ ] Add loading spinners/skeleton screens
- [ ] Add success/error boundaries for React components
- [ ] Add i18n for error messages
- [ ] Add analytics tracking for errors

## Files Modified/Created

### Frontend
- ✅ Created: `frontend/src/utils/toast.ts`
- ✅ Modified: `frontend/src/services/api.ts`
- ✅ Created: `frontend/src/components/ErrorHandlingDemo.tsx` (test only)

### Backend
- ✅ Created: `backend/src/filters/http-exception.filter.ts`
- ✅ Modified: `backend/src/main.ts`

### Documentation
- ✅ Created: `docs/ERROR_HANDLING.md` (this file)
