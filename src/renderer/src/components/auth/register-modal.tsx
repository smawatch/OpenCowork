import React, { useState } from 'react';
import { Loader2, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../stores/auth-store';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

// Extend Window interface for temporary login data
declare global {
  interface Window {
    _pendingUser?: any;
    _pendingToken?: string;
  }
}

interface RegisterModalProps {
  onSwitchToLogin?: () => void;
}

export const RegisterModal: React.FC<RegisterModalProps> = ({ onSwitchToLogin }) => {
  const [formData, setFormData] = useState({
    username: '',
    email: ''
  });
  const [error, setError] = useState('');
  const [activationSuccess, setActivationSuccess] = useState(false);
  const { register, isLoading, registrationStatus, resetRegistration } = useAuthStore();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (error) setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.username.trim() || !formData.email.trim()) {
      setError('请填写用户名和邮箱');
      return;
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setError('请输入有效的邮箱地址');
      return;
    }

    try {
      await register({
        username: formData.username,
        email: formData.email
      });
    } catch (err: any) {
      setError(err.message || '注册申请失败');
    }
  };

  const handleBackToLogin = () => {
    resetRegistration();
    if (onSwitchToLogin) onSwitchToLogin();
  };

  const handleRefreshAndLogin = async () => {
    setError('');
    try {
      // 直接调用登录 API
      const result = await window.api.userLogin({
        username: formData.username,
        password: 'sma@123456'
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      // 登录成功，保存 token 但不更新 isAuthenticated（避免立即跳转）
      const { user, tokens } = result.data;
      localStorage.setItem('authToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
      await window.api.authSaveToken(tokens.accessToken);

      // 临时保存用户信息用于显示
      window._pendingUser = user;
      window._pendingToken = tokens.accessToken;

      console.log('[RegisterModal] 登录成功，保存 token，等待用户确认');

      // 显示激活成功提醒
      setActivationSuccess(true);
    } catch (err: any) {
      if (err.message?.includes('尚未激活') || err.message?.includes('pending')) {
        setError('您的账号尚未激活，请联系管理员');
      } else {
        setError(err.message || '登录失败，请稍后重试');
      }
    }
  };

  // Activation success screen
  if (activationSuccess) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
        <div className="w-full max-w-lg space-y-6 rounded-xl border bg-card p-10 shadow-xl">
          <div className="flex flex-col items-center space-y-5 text-center">
            {/* Green checkmark icon */}
            <div className="flex size-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <CheckCircle2 className="size-12 text-green-600 dark:text-green-400" />
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">激活成功</h1>
              <p className="text-sm text-muted-foreground">
                您的账号已激活，已成功登录
              </p>
            </div>

            {/* User info */}
            <div className="w-full space-y-3 rounded-lg border bg-muted/50 p-4 text-left">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">登录用户名：</span>
                <span className="font-medium text-foreground">{formData.username}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground" style={{ color: 'red' }}>初始密码（请及时修改）：</span>
                <span className="font-medium text-foreground" style={{ color: 'red' }}>sma@123456</span>
              </div>
            </div>
          </div>

          <Button
            onClick={() => {
              console.log('[RegisterModal] 点击"进入系统"按钮');
              // 从临时存储中恢复用户信息并更新状态
              const pendingUser = (window as any)._pendingUser;
              const pendingToken = (window as any)._pendingToken;

              if (pendingUser && pendingToken) {
                useAuthStore.setState({
                  isAuthenticated: true,
                  user: pendingUser,
                  token: pendingToken
                });
                console.log('[RegisterModal] authStore 已更新，即将进入主界面');
                // 清理临时数据
                delete (window as any)._pendingUser;
                delete (window as any)._pendingToken;
              }

              resetRegistration();
            }}
            className="w-full bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-700 dark:hover:bg-teal-600"
            size="lg"
          >
            进入系统
          </Button>
        </div>
      </div>
    );
  }

  // Pending activation screen
  if (registrationStatus === 'pending') {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-lg">
          <div className="flex flex-col items-center space-y-4 text-center">
            <CheckCircle2 className="size-16 text-blue-500" />
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">申请已提交</h1>
              <p className="text-sm text-muted-foreground">
                您的账号注册申请已提交，当前状态为
                <span className="font-semibold text-amber-600"> 待激活</span>
              </p>
            </div>
            <div className="w-full rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
              请联系系统管理员激活您的账号，激活后点击下方刷新按钮即可登录。
            </div>
            <div className="w-full space-y-2 text-left text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>用户名：</span>
                <span className="font-medium text-foreground">{formData.username || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>邮箱：</span>
                <span className="font-medium text-foreground">{formData.email || '—'}</span>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Button
              onClick={handleRefreshAndLogin}
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  检查激活状态中...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 size-4" />
                  刷新并登录
                </>
              )}
            </Button>
            <Button
              onClick={handleBackToLogin}
              className="w-full"
              size="lg"
              variant="outline"
              disabled={isLoading}
            >
              返回登录
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-lg">
        {/* Header */}
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">申请账号</h1>
          <p className="text-sm text-muted-foreground">提交注册申请，等待管理员激活</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Error Message */}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Username */}
          <div className="space-y-2">
            <label htmlFor="reg-username" className="text-sm font-medium text-foreground">
              用户名 <span className="text-destructive">*</span>
            </label>
            <Input
              id="reg-username"
              name="username"
              type="text"
              value={formData.username}
              onChange={handleChange}
              placeholder="请输入用户名"
              disabled={isLoading}
              required
            />
          </div>

          {/* Email */}
          <div className="space-y-2">
            <label htmlFor="reg-email" className="text-sm font-medium text-foreground">
              邮箱 <span className="text-destructive">*</span>
            </label>
            <Input
              id="reg-email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com"
              disabled={isLoading}
              required
            />
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full"
            size="lg"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                提交申请中...
              </>
            ) : (
              '提交注册申请'
            )}
          </Button>

          {/* Login Link */}
          <div className="text-center text-sm">
            <span className="text-muted-foreground">已有账号？ </span>
            <button
              type="button"
              onClick={onSwitchToLogin}
              disabled={isLoading}
              className="font-medium text-primary hover:text-primary/80 disabled:pointer-events-none disabled:opacity-50"
            >
              立即登录
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
