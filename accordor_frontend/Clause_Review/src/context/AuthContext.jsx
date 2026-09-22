import React, { createContext, useContext, useState, useEffect } from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  // `loading` is true during the initial session rehydration on mount and
  // during any login / signup / logout call so the UI can show a spinner.
  const [loading, setLoading] = useState(true);

  // -------------------------------------------------------------------------
  // On mount: rehydrate the session from the stored token by calling /me/.
  // If the token is missing, expired, or revoked on the server the call
  // returns null and we stay unauthenticated.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    authService.me()
      .then((user) => {
        if (!cancelled) setCurrentUser(user);
      })
      .catch(() => {
        if (!cancelled) setCurrentUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------
  const login = async (email, password, rememberMe = false) => {
    setLoading(true);
    try {
      const { user } = await authService.login({
        email,
        password,
        remember_me: rememberMe,
      });
      setCurrentUser(user);
      return user;
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // signup — now accepts role in the payload
  // -------------------------------------------------------------------------
  const signup = async ({ username, email, password, role, rememberMe = false }) => {
    setLoading(true);
    try {
      const { user } = await authService.signup({
        username,
        email,
        password,
        role,
        remember_me: rememberMe,
      });
      setCurrentUser(user);
      return user;
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------
  const logout = async () => {
    setLoading(true);
    try {
      await authService.logout();
    } finally {
      setCurrentUser(null);
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // demoLogin — hits the real backend with the demo account
  // -------------------------------------------------------------------------
  const demoLogin = () => login('reviewer@clausewright.com', 'password123');

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: Boolean(currentUser),
        loading,
        login,
        signup,
        logout,
        demoLogin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
