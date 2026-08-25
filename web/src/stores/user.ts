import { useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'
import api from '@/api'

export interface AdminInfo {
  username: string
  role: 'admin' | 'user'
  avatar?: string
  mustChangePassword?: boolean
  quota?: any
  id?: string
  createdAt?: number
  durationEnd?: number
}

export interface LoginResult {
  ok: boolean
  error?: string
  errorType?: 'rate_limit' | 'locked' | 'invalid_credentials'
  remainingMs?: number
  data?: {
    token: string
    role: 'admin' | 'user'
    user: { username: string; id?: string }
    mustChangePassword?: boolean
    quota?: any
  }
}

export interface RegisterResult {
  ok: boolean
  error?: string
  code?: string
  data?: {
    token: string
    role: 'user'
    user: { username: string; id: string }
    quota?: any
  }
}

export const useUserStore = defineStore('user', () => {
  const token = useStorage('admin_token', '')
  const userInfo = useStorage<AdminInfo | null>('user_info', null, undefined, {
    serializer: {
      read: (v: string) => {
        try {
          return (v ? JSON.parse(v) : null) as AdminInfo | null
        }
        catch {
          return null
        }
      },
      write: (v: AdminInfo | null) => JSON.stringify(v),
    },
  })
  const isLoggedIn = computed(() => !!token.value)
  const username = computed(() => userInfo.value?.username || '')
  const avatar = computed(() => userInfo.value?.avatar || '')
  const role = computed(() => userInfo.value?.role || 'admin')
  const isAdmin = computed(() => userInfo.value?.role === 'admin')
  const isUser = computed(() => userInfo.value?.role === 'user')

  async function login(username: string, password: string): Promise<LoginResult> {
    try {
      const res = await api.post('/api/login', { username, password })
      if (res.data.ok) {
        token.value = res.data.data.token
        userInfo.value = {
          username: res.data.data.user.username,
          role: res.data.data.role,
          mustChangePassword: res.data.data.mustChangePassword,
          quota: res.data.data.quota,
        }
      }
      return res.data
    }
    catch (error: any) {
      const data = error.response?.data
      return data
        ? { ok: false, error: data.error, errorType: data.errorType, remainingMs: data.remainingMs }
        : { ok: false, error: error.message || '网络错误' }
    }
  }

  async function register(username: string, password: string, cardCode: string): Promise<RegisterResult> {
    try {
      const res = await api.post('/api/register', { username, password, cardCode })
      if (res.data.ok) {
        token.value = res.data.data.token
        userInfo.value = {
          username: res.data.data.user.username,
          role: 'user',
          quota: res.data.data.quota,
        }
      }
      return res.data
    }
    catch (error: any) {
      const data = error.response?.data
      return data
        ? { ok: false, error: data.error, code: data.code }
        : { ok: false, error: error.message || '网络错误' }
    }
  }

  async function logout() {
    try {
      await api.post('/api/logout')
    }
    finally {
      token.value = ''
      userInfo.value = null
    }
  }

  async function fetchUserInfo() {
    try {
      const res = await api.get('/api/user/me')
      if (res.data.ok)
        userInfo.value = res.data.data
      return res.data
    }
    catch {
      return { ok: false }
    }
  }

  async function fetchQuota() {
    const res = await api.get('/api/user/quota')
    return res.data
  }

  async function changePassword(oldPassword: string, newPassword: string) {
    const res = await api.post('/api/user/change-password', { oldPassword, newPassword })
    return res.data
  }

  async function redeemCard(cardCode: string) {
    const res = await api.post('/api/user/redeem-card', { cardCode })
    return res.data
  }

  return {
    token,
    userInfo,
    isLoggedIn,
    username,
    avatar,
    role,
    isAdmin,
    isUser,
    login,
    register,
    logout,
    fetchUserInfo,
    fetchQuota,
    changePassword,
    redeemCard,
  }
})
