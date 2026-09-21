import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

const STORAGE_AUTH_KEY = 'clausewright_auth_user';
const STORAGE_USERS_KEY = 'clausewright_registered_users';

const DEFAULT_USERS = [
  {
    id: 'user-default-1',
    username: 'Demo Reviewer',
    email: 'reviewer@clausewright.com',
    password: 'password123',
    role: 'Senior Legal Reviewer',
  },
];

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_AUTH_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(false);

  // Initialize registered users in localStorage if empty
  useEffect(() => {
    try {
      const existing = localStorage.getItem(STORAGE_USERS_KEY);
      if (!existing) {
        localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(DEFAULT_USERS));
      }
    } catch (e) {
      console.warn('Could not initialize users store:', e);
    }
  }, []);

  const getRegisteredUsers = () => {
    try {
      const users = localStorage.getItem(STORAGE_USERS_KEY);
      return users ? JSON.parse(users) : DEFAULT_USERS;
    } catch {
      return DEFAULT_USERS;
    }
  };

  const login = async (email, password) => {
    setLoading(true);
    // Simulate realistic asynchronous network authentication delay
    await new Promise((resolve) => setTimeout(resolve, 400));

    const normalizedEmail = (email || '').trim().toLowerCase();
    const users = getRegisteredUsers();
    const foundUser = users.find(
      (u) => u.email.toLowerCase() === normalizedEmail && u.password === password
    );

    if (!foundUser) {
      setLoading(false);
      throw new Error('Invalid email or password. Please try again.');
    }

    const sessionUser = {
      id: foundUser.id,
      username: foundUser.username,
      email: foundUser.email,
      role: foundUser.role || 'Legal Reviewer',
      lastLogin: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(sessionUser));
    setCurrentUser(sessionUser);
    setLoading(false);
    return sessionUser;
  };

  const signup = async ({ username, email, password }) => {
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 450));

    const normalizedEmail = (email || '').trim().toLowerCase();
    const users = getRegisteredUsers();

    if (users.some((u) => u.email.toLowerCase() === normalizedEmail)) {
      setLoading(false);
      throw new Error('An account with this email address already exists.');
    }

    const newUser = {
      id: `user-${Date.now()}`,
      username: username.trim(),
      email: normalizedEmail,
      password: password,
      role: 'Legal Reviewer',
      createdAt: new Date().toISOString(),
    };

    const updatedUsers = [...users, newUser];
    localStorage.setItem(STORAGE_USERS_KEY, JSON.stringify(updatedUsers));

    const sessionUser = {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      role: newUser.role,
      lastLogin: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(sessionUser));
    setCurrentUser(sessionUser);
    setLoading(false);
    return sessionUser;
  };

  const logout = () => {
    try {
      localStorage.removeItem(STORAGE_AUTH_KEY);
    } catch (e) {
      console.warn('Logout error:', e);
    }
    setCurrentUser(null);
  };

  const demoLogin = async () => {
    return login('reviewer@clausewright.com', 'password123');
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

