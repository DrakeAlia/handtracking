# Project Instructions for Claude

## Tech Stack

- **Frontend**: Vite + React + TypeScript
- **Styling**: Tailwind CSS
- **Backend**: Supabase

## Development Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking

## Project Structure

- `src/app/` - Next.js app router pages
- `src/components/` - Reusable React components
- `src/lib/` - Utility functions and configurations
- `src/types/` - TypeScript type definitions

## Dependencies

- React 18+ with TypeScript
- Tailwind CSS for styling
- Supabase client for backend integration
- ESLint for code linting

## Code Style

- Use TypeScript for all components and utilities
- Follow React functional component patterns with hooks
- Use Tailwind classes for styling
- Implement proper error handling for Supabase operations
- Use proper TypeScript types for all data structures

## Supabase Integration

- Configure Supabase client in `src/lib/supabase.ts`
- Use Supabase Auth for authentication
- Use Supabase Database for data storage
- Implement proper error handling for database operations

## State Management

- Use React Context API for global state management
- Implement custom hooks for reusable state logic
- Consider Zustand for complex state management needs
- Follow these patterns for state organization:
  - Keep UI state local to components when possible
  - Use Context for theme, auth, and app-wide settings
  - Implement Zustand stores for complex data flows
  - Create custom hooks for shared state logic
  - Use proper TypeScript types for all state

### State Management Best Practices

- Keep state as close as possible to where it's used
- Use `useState` for simple component state
- Use `useReducer` for complex state logic
- Implement proper loading and error states
- Cache API responses when appropriate
- Use memoization (`useMemo`, `useCallback`) for performance
- Implement proper TypeScript types for all state objects
