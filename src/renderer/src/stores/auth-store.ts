import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  phone?: string;
  departmentId?: string;
  roles: string[];
  permissions: string[];
}

export type RegistrationStatus = 'none' | 'pending';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  registrationStatus: RegistrationStatus;
  login: (username: string, password: string) => Promise<void>;
  register: (data: { username: string; email: string }) => Promise<void>;
  resetRegistration: () => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateUser: (user: Partial<User>) => void;
  getValidToken: () => Promise<string | null>;
}

// ── JWT helpers ──

interface JwtPayload {
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function isTokenExpired(token: string, skewMs = 60_000): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false; // no exp claim — assume not expired
  return Date.now() >= (payload.exp * 1000 - skewMs);
}

// ── Token refresh lock (prevent concurrent refresh) ──

let refreshPromise: Promise<string | null> | null = null;

// ── Store ──

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      registrationStatus: 'none',

      checkAuth: async () => {
        const result = await window.api.authCheck();
        if (result.authenticated && result.user) {
          const storedToken = localStorage.getItem('authToken');
          // If the stored token is expired, try to refresh it
          if (storedToken && isTokenExpired(storedToken)) {
            const newToken = await get().getValidToken();
            if (newToken) {
              set({ isAuthenticated: true, user: result.user, token: newToken });
              return;
            }
            // Refresh failed — force logout
            await get().logout();
            return;
          }
          set({
            isAuthenticated: true,
            user: result.user,
            token: storedToken
          });
        }
      },

      /** Get a valid token, refreshing if necessary. Safe to call before any API request. */
      getValidToken: async (): Promise<string | null> => {
        const currentToken = get().token || localStorage.getItem('authToken');
        if (!currentToken) return null;

        // Token is still valid — return as-is
        if (!isTokenExpired(currentToken)) return currentToken;

        // Token expired — refresh it
        const refreshToken = localStorage.getItem('refreshToken');
        if (!refreshToken) return null;

        // Deduplicate concurrent refresh attempts
        if (refreshPromise) return refreshPromise;

        refreshPromise = (async (): Promise<string | null> => {
          try {
            const result = await window.api.userRefreshToken();
            if (result.success && result.data?.tokens) {
              const { accessToken, refreshToken: newRefreshToken } = result.data.tokens;

              localStorage.setItem('authToken', accessToken);
              if (newRefreshToken) {
                localStorage.setItem('refreshToken', newRefreshToken);
              }
              await window.api.authSaveToken({
                token: accessToken,
                refreshToken: newRefreshToken
              });

              set({ token: accessToken, isAuthenticated: true });
              return accessToken;
            }
            return null;
          } catch {
            return null;
          } finally {
            refreshPromise = null;
          }
        })();

        return refreshPromise;
      },

      login: async (username: string, password: string) => {
        set({ isLoading: true });
        try {
          const result = await window.api.userLogin({ username, password });

          if (!result.success) {
            throw new Error(result.error);
          }

          const { user, tokens } = result.data;
          localStorage.setItem('authToken', tokens.accessToken);
          localStorage.setItem('refreshToken', tokens.refreshToken);

          // Save both tokens to main process
          await window.api.authSaveToken({
            token: tokens.accessToken,
            refreshToken: tokens.refreshToken
          });

          set({
            isAuthenticated: true,
            user,
            token: tokens.accessToken,
            isLoading: false
          });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (data: { username: string; email: string }) => {
        set({ isLoading: true });
        try {
          const result = await window.api.userRegister(data);

          if (!result.success) {
            throw new Error(result.error);
          }

          set({
            registrationStatus: 'pending',
            isLoading: false
          });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      resetRegistration: () => {
        set({ registrationStatus: 'none' });
      },

      logout: async () => {
        await window.api.authClear();
        localStorage.removeItem('authToken');
        localStorage.removeItem('refreshToken');
        refreshPromise = null;

        set({
          user: null,
          token: null,
          isAuthenticated: false
        });
      },

      updateUser: (userData: Partial<User>) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null
        }));
      }
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated
      }),
    }
  )
);

// ── Dev console test helpers ──
if (typeof window !== 'undefined') {
  (window as any).__authTest = {
    /** Check current token status */
    status: () => {
      const token = localStorage.getItem('authToken');
      const refresh = localStorage.getItem('refreshToken');
      if (!token) return 'No token stored';
      const payload = decodeJwtPayload(token);
      const expired = isTokenExpired(token);
      return {
        tokenPreview: token.slice(0, 20) + '...' + token.slice(-10),
        exp: payload?.exp ? new Date(payload.exp * 1000).toLocaleString() : 'unknown',
        expired,
        hasRefreshToken: !!refresh,
        timeNow: new Date().toLocaleString()
      };
    },
    /** Force token refresh (for testing) */
    refresh: async () => {
      const result = await useAuthStore.getState().getValidToken();
      if (result) {
        console.log('[authTest] Token refreshed:', result.slice(0, 20) + '...');
      } else {
        console.log('[authTest] Refresh failed');
      }
      return result;
    }
  };
}
