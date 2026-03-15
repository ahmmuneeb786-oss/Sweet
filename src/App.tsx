import { useState, useEffect } from 'react'; // final build attempt 1
import { useAuth, AuthProvider } from './contexts/AuthContext';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';

function AppContent() {
  const { user, loading } = useAuth();

  // Theme state: 'light', 'dark', or 'romantic'
  const [theme, setTheme] = useState<'light' | 'dark' | 'romantic'>('light');

  // Load saved theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'romantic';
    if (savedTheme) setTheme(savedTheme);
  }, []);

  // Save theme to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  // 1. Loading State
  if (loading) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div
          className={`min-h-screen flex items-center justify-center transition-colors duration-300 ${
            theme === 'romantic'
              ? 'bg-[#FFE4E1]'
              : 'bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-700'
          }`}
        >
          <div className="text-center space-y-4">
            <div
              className={`w-16 h-16 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto ${
                theme === 'dark' ? 'dark:border-gray-500' : theme === 'romantic' ? 'border-[#FF69B4]' : ''
              }`}
            />
            <p className={`font-medium ${
              theme === 'dark' ? 'text-gray-300' : theme === 'romantic' ? 'text-[#4B004B]' : 'text-gray-600'
            }`}>
              Loading Sweet...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Auth State (Not Logged In)
  if (!user) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
          <Auth />
        </div>
      </div>
    );
  }

  // 3. Main App State (Logged In)
  return (
    <div className={theme === 'dark' ? 'dark' : theme === 'romantic' ? 'romantic-theme' : ''}>
      <div
        className={`min-h-screen transition-colors duration-300 ${
          theme === 'dark'
            ? 'bg-gray-900 text-white'
            : theme === 'romantic'
            ? 'bg-[#FFE4E1] text-[#4B004B]'
            : 'bg-gray-50 text-gray-900'
        }`}
      >
        <Dashboard theme={theme} setTheme={setTheme} />
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
