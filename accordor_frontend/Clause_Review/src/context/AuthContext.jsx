import React, { createContext, useContext, useState, useEffect } from 'react';
import * as authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => authService.getStoredUser());
  const [loading, setLoading] = useState(false);

  // -------------------------------------------------------------------------
  // On mount: validate the session in the background from /me/.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    authService.me()
      .then((user) => {
        if (!cancelled && user) {
          setCurrentUser(user);
        }
      })
      .catch((err) => {
        if (!cancelled && err?.status === 401) {
          setCurrentUser(null);
        }
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
      const data = await authService.signup({
        username,
        email,
        password,
        role,
        remember_me: rememberMe,
      });
      authService.clearStoredToken();
      setCurrentUser(null);
      return data?.user || data;
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // logout — instant local clear, server call in background
  // -------------------------------------------------------------------------
  const logout = () => {
    authService.clearStoredToken();
    setCurrentUser(null);
    authService.logout().catch(() => {});
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: Boolean(currentUser),
        loading,
        login,
        signup,
        logout,
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
