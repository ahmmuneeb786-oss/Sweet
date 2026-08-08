import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // This is exactly what was missing — without it, an error here just
    // vanishes and the screen goes blank with zero trace of why.
    console.error('App crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#FFF0F3] p-6">
          <div className="max-w-sm w-full bg-white rounded-3xl shadow-xl p-6 text-center space-y-4">
            <div className="text-4xl">💔</div>
            <h2 className="text-lg font-bold text-gray-900">Something went wrong</h2>
            <p className="text-sm text-gray-500 break-words">
              {this.state.error.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 rounded-xl bg-pink-500 text-white font-bold hover:bg-pink-600 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}