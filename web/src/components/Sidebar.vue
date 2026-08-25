<script setup lang="ts">
import { useDateFormat, useIntervalFn, useNow } from '@vueuse/core'
import { NButton } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/api'
import AccountModal from '@/components/AccountModal.vue'
import RemarkModal from '@/components/RemarkModal.vue'
import { menuRoutes } from '@/router/menu'
import { getPlatformClass, getPlatformLabel, useAccountStore } from '@/stores/account'
import { useAppStore } from '@/stores/app'
import { useStatusStore } from '@/stores/status'
import { useUserStore } from '@/stores/user'
import { copyTextToClipboard } from '@/utils/clipboard'

const accountStore = useAccountStore()
const statusStore = useStatusStore()
const appStore = useAppStore()
const userStore = useUserStore()
const route = useRoute()
const router = useRouter()
const { accounts, currentAccount } = storeToRefs(accountStore)
const { status, realtimeConnected } = storeToRefs(statusStore)
const { sidebarOpen } = storeToRefs(appStore)
const editIconClass = 'i-carbon-edit'

const showAccountDropdown = ref(false)
const showAccountModal = ref(false)
const showRemarkModal = ref(false)
const accountToEdit = ref<any>(null)
const wsErrorNotifiedAt = ref<Record<string, number>>({})
const accountAvatarErrors = ref<Set<string>>(new Set())

const systemConnected = ref(true)
const serverUptimeBase = ref(0)
const serverVersion = ref('')
const lastPingTime = ref(Date.now())
const now = useNow({ interval: 1000 })
const formattedTime = useDateFormat(now, 'YYYY-MM-DD HH:mm:ss')

async function checkConnection() {
  try {
    const res = await api.get('/api/ping')
    systemConnected.value = true
    if (res.data.ok && res.data.data) {
      if (res.data.data.uptime) {
        serverUptimeBase.value = res.data.data.uptime
        lastPingTime.value = Date.now()
      }
      if (res.data.data.version) {
        serverVersion.value = res.data.data.version
      }
    }
    const accountRef = currentAccount.value?.id || currentAccount.value?.uin
    if (accountRef) {
      statusStore.connectRealtime(String(accountRef))
    }
  }
  catch {
    systemConnected.value = false
  }
}

async function refreshStatusFallback() {
  if (realtimeConnected.value)
    return

  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  if (accountRef) {
    await statusStore.fetchStatus(String(accountRef))
  }
}

async function handleAccountSaved() {
  await accountStore.fetchAccounts()
  await refreshStatusFallback()
  showAccountModal.value = false
  showRemarkModal.value = false
}

function openRemarkModal(acc: any) {
  accountToEdit.value = acc
  showRemarkModal.value = true
  showAccountDropdown.value = false
}

onMounted(() => {
  accountStore.fetchAccounts()
  checkConnection()
  // 获取当前用户信息
  userStore.fetchUserInfo()
})

onBeforeUnmount(() => {
  statusStore.disconnectRealtime()
})

const platform = computed(() => getPlatformLabel(currentAccount.value?.platform))

function getAccountAvatar(account: any) {
  if (!account)
    return ''
  const accountId = String(account.id || '')
  const liveAccountId = String(status.value?.accountId || '')
  const liveAvatar = accountId && accountId === liveAccountId
    ? String(status.value?.status?.avatarUrl || '').trim()
    : ''
  return liveAvatar || String(account.avatar || '').trim()
}

function canShowAccountAvatar(account: any) {
  const accountId = String(account?.id || '')
  return !!getAccountAvatar(account) && !accountAvatarErrors.value.has(accountId)
}

function handleAccountAvatarError(account: any) {
  const accountId = String(account?.id || '')
  if (accountId)
    accountAvatarErrors.value.add(accountId)
}

useIntervalFn(checkConnection, 30000)
useIntervalFn(refreshStatusFallback, 10000)

watch(() => currentAccount.value?.id || currentAccount.value?.uin || '', () => {
  const accountRef = currentAccount.value?.id || currentAccount.value?.uin
  statusStore.connectRealtime(String(accountRef || ''))
  refreshStatusFallback()
}, { immediate: true })

watch(
  () => [status.value?.accountId, status.value?.status?.avatarUrl] as const,
  ([accountId, avatar]) => {
    const normalizedId = String(accountId || '')
    const normalizedAvatar = String(avatar || '').trim()
    if (!normalizedId || !normalizedAvatar)
      return
    accountStore.syncAccountAvatar(normalizedId, normalizedAvatar)
    accountAvatarErrors.value.delete(normalizedId)
  },
)

watch(() => status.value?.wsError, (wsError: any) => {
  if (!wsError || Number(wsError.code) !== 400 || !currentAccount.value)
    return

  const errAt = Number(wsError.at) || 0
  const accId = String(currentAccount.value.id || currentAccount.value.uin || '')
  const lastNotified = wsErrorNotifiedAt.value[accId] || 0
  if (errAt <= lastNotified)
    return

  wsErrorNotifiedAt.value[accId] = errAt
  accountToEdit.value = currentAccount.value
  showAccountModal.value = true
}, { deep: true })

const uptime = computed(() => {
  const diff = Math.floor(serverUptimeBase.value + (now.value.getTime() - lastPingTime.value) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${h}h ${m}m ${s}s`
})

const displayName = computed(() => {
  const acc = currentAccount.value
  if (!acc)
    return '选择账号'

  // 1. 优先显示实时状态中的昵称 (如果有且不是未登录)
  const liveName = status.value?.status?.name
  if (liveName && liveName !== '未登录') {
    // 如果有备注，显示为"昵称（备注）"
    if (acc.name) {
      return `${liveName} (${acc.name})`
    }
    return liveName
  }

  // 2. 其次显示账号存储的备注名称 (name)
  if (acc.name) {
    // 如果有同步的昵称，显示为"昵称（备注）"
    if (acc.nick) {
      return `${acc.nick} (${acc.name})`
    }
    return acc.name
  }

  // 3. 显示同步的昵称 (nick)
  if (acc.nick)
    return acc.nick

  // 4. 最后显示UIN
  return acc.uin
})

const connectionStatus = computed(() => {
  if (!systemConnected.value) {
    return {
      text: '系统离线',
      color: 'bg-red-500',
      pulse: false,
    }
  }

  if (!currentAccount.value?.id) {
    return {
      text: '请添加账号',
      color: 'bg-gray-400',
      pulse: false,
    }
  }

  const isConnected = status.value?.connection?.connected
  if (isConnected) {
    return {
      text: '运行中',
      color: 'bg-green-500',
      pulse: true,
    }
  }

  return {
    text: '未连接',
    color: 'bg-gray-400', // Or red? Old version uses gray/offline class which is gray usually
    pulse: false,
  }
})

const navItems = computed(() => {
  const currentRole = userStore.role || 'admin'
  return menuRoutes
    .filter((item) => {
      if (!item.meta?.roles) return true
      return item.meta.roles.includes(currentRole as 'admin' | 'user')
    })
    .map(item => ({
      path: item.path ? `/${item.path}` : '/',
      label: item.label,
      icon: item.icon,
    }))
})

function selectAccount(acc: any) {
  accountStore.setCurrentAccount(acc)
  showAccountDropdown.value = false
}

const version = __APP_VERSION__

watch(
  () => route.path,
  () => {
    // Close sidebar on route change (mobile only)
    if (window.innerWidth < 1024)
      appStore.closeSidebar()
  },
)

// 用户相关
const showUserDropdown = ref(false)
const showTokenDropdown = ref(false)
const tokenVisible = ref(false)
const tokenCopied = ref(false)

async function handleLogout() {
  await userStore.logout()
  router.push('/login')
}

async function copyToken() {
  const tokenValue = userStore.token
  if (!tokenValue)
    return

  const ok = await copyTextToClipboard(tokenValue)
  if (ok) {
    tokenCopied.value = true
    setTimeout(() => {
      tokenCopied.value = false
    }, 2000)
  }
  else {
    console.error('复制失败')
  }
}
</script>

<template>
  <aside
    class="app-sidebar fixed inset-y-0 left-0 z-50 h-full w-[248px] flex flex-col transition-transform duration-200 lg:static lg:translate-x-0"
    :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
  >
    <!-- Brand -->
    <div class="sidebar-brand h-15 flex items-center justify-between px-4">
      <div class="min-w-0 flex items-center gap-2.5">
        <span class="brand-mark i-carbon-sprout" />
        <span class="min-w-0 truncate text-sm font-semibold font-display">
          QQ农场智能助手
        </span>
      </div>
      <!-- Mobile Close Button -->
      <NButton
        class="lg:hidden"
        quaternary
        circle
        aria-label="关闭侧栏"
        @click="appStore.closeSidebar"
      >
        <div class="i-carbon-close text-xl" />
      </NButton>
    </div>

    <!-- User Info -->
    <div class="border-b border-gray-200/40 p-4 dark:border-gray-700/40">
      <div class="group relative">
        <button
          class="sidebar-control w-full flex items-center justify-between px-3 py-2.5 outline-none transition-colors duration-150"
          style="--focus-ring: var(--theme-primary)"
          @click="showUserDropdown = !showUserDropdown"
        >
          <div class="flex items-center gap-3 overflow-hidden">
            <div class="farm-avatar-ring relative h-9 w-9 shrink-0 overflow-hidden rounded-full shadow-md" style="background: var(--ui-primary); padding: 2px;">
              <div class="h-full w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                <img
                  :src="userStore.avatar || 'https://thirdqq.qlogo.cn/qqapp/1112386029/BF9C8FC0E5563BEBD93B22F14A9C0566/100'"
                  class="h-full w-full object-cover"
                  @error="(e) => (e.target as HTMLImageElement).src = 'https://thirdqq.qlogo.cn/qqapp/1112386029/BF9C8FC0E5563BEBD93B22F14A9C0566/100'"
                >
              </div>
              <div class="admin-star absolute z-10 h-4 w-4 flex items-center justify-center rounded-full text-[8px] shadow-sm -right-1 -top-1">
                <span>&#9733;</span>
              </div>
            </div>
            <div class="min-w-0 flex flex-col items-start">
              <span class="font-body w-full truncate text-left text-sm font-medium">
                {{ userStore.username || '未登录' }}
              </span>
              <div class="mt-0.5 flex items-center gap-1.5">
                <span
                  class="admin-badge rounded-lg px-1.5 py-0.2 text-[10px] font-medium leading-tight"
                >
                  超级管理员
                </span>
              </div>
            </div>
          </div>
          <div
            class="i-carbon-chevron-down text-gray-400 transition-transform duration-200"
            :class="{ 'rotate-180': showUserDropdown }"
          />
        </button>

        <!-- User Dropdown Menu -->
        <div
          v-if="showUserDropdown"
          class="sidebar-dropdown absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden py-1"
        >
          <div class="border-b border-gray-100/60 px-4 py-2 dark:border-gray-700/60">
            <div class="text-sm text-gray-900 font-medium dark:text-white">
              {{ userStore.username }}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              超级管理员
            </div>
          </div>
          <div class="py-1">
            <NButton
              class="sidebar-menu-button"

              quaternary block
              type="error"
              @click="handleLogout"
            >
              <div class="i-carbon-logout" />
              <span>退出登录</span>
            </NButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Account Selector -->
    <div class="border-b border-gray-200/40 p-4 dark:border-gray-700/40">
      <div class="group relative">
        <button
          class="sidebar-control w-full flex items-center justify-between px-3 py-2.5 outline-none transition-colors duration-150"
          @click="showAccountDropdown = !showAccountDropdown"
        >
          <div class="flex items-center gap-3 overflow-hidden">
            <div class="h-8 w-8 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 shadow-sm ring-2 ring-green-300/50 dark:bg-gray-600 dark:ring-green-700/50">
              <img
                v-if="canShowAccountAvatar(currentAccount)"
                :src="getAccountAvatar(currentAccount)"
                class="h-full w-full object-cover"
                @error="handleAccountAvatarError(currentAccount)"
              >
              <div v-else class="i-carbon-user text-gray-400" />
            </div>
            <div class="min-w-0 flex flex-col items-start">
              <span class="font-body w-full truncate text-left text-sm font-medium">
                {{ displayName }}
              </span>
              <div class="mt-0.5 flex items-center gap-1.5">
                <span
                  v-if="platform"
                  class="rounded-lg px-1.5 py-0.2 text-[10px] font-medium leading-tight"
                  :class="getPlatformClass(currentAccount?.platform)"
                >
                  {{ platform }}
                </span>
                <span class="truncate text-xs text-gray-400">
                  {{ currentAccount?.uin || currentAccount?.id || '未选择' }}
                </span>
              </div>
            </div>
          </div>
          <div
            class="i-carbon-chevron-down text-gray-400 transition-transform duration-200"
            :class="{ 'rotate-180': showAccountDropdown }"
          />
        </button>

        <!-- Dropdown Menu -->
        <div
          v-if="showAccountDropdown"
          class="sidebar-dropdown absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden py-1"
        >
          <div class="custom-scrollbar max-h-60 overflow-y-auto">
            <template v-if="accounts.length > 0">
              <div
                v-for="acc in accounts"
                :key="acc.id || acc.uin"
                class="flex items-center rounded-xl transition-colors hover:bg-gray-100/50 dark:hover:bg-gray-700/50"
                :class="{ 'bg-green-50/50 dark:bg-green-900/20': currentAccount?.id === acc.id }"
                :style="{ backgroundColor: currentAccount?.id === acc.id ? 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' : undefined }"
              >
                <button class="min-w-0 flex flex-1 items-center gap-3 px-3 py-2" @click="selectAccount(acc)">
                  <div class="h-6 w-6 flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 shadow-sm dark:bg-gray-600">
                    <img
                      v-if="canShowAccountAvatar(acc)"
                      :src="getAccountAvatar(acc)"
                      class="h-full w-full object-cover"
                      @error="handleAccountAvatarError(acc)"
                    >
                    <div v-else class="i-carbon-user text-gray-400" />
                  </div>
                  <div class="min-w-0 flex flex-1 flex-col items-start">
                    <span class="w-full truncate text-left text-sm font-medium">
                      {{ acc.nick && acc.name ? `${acc.nick} (${acc.name})` : acc.name || acc.nick || acc.uin }}
                    </span>
                    <div class="flex items-center gap-1.5">
                      <span
                        v-if="getPlatformLabel(acc.platform)"
                        class="rounded-lg px-1.5 py-0.2 text-[10px] font-medium leading-tight"
                        :class="getPlatformClass(acc.platform)"
                      >
                        {{ getPlatformLabel(acc.platform) }}
                      </span>
                      <span class="text-xs text-gray-400">{{ acc.uin || acc.id }}</span>
                    </div>
                  </div>
                  <div v-if="currentAccount?.id === acc.id" class="i-carbon-checkmark" :style="{ color: 'var(--theme-primary)' }" />
                </button>
                <NButton quaternary circle size="tiny" title="修改备注" aria-label="修改备注" @click="openRemarkModal(acc)">
                  <div :class="editIconClass" />
                </NButton>
              </div>
            </template>
            <div v-else class="px-4 py-3 text-center text-sm text-gray-400">
              暂无账号
            </div>
          </div>
          <div class="mt-1 border-t border-gray-100/60 px-1 pt-1 dark:border-gray-700/60">
            <NButton
              class="sidebar-menu-button"

              quaternary block
              type="primary"
              @click="showAccountModal = true; showAccountDropdown = false"
            >
              <div class="i-carbon-add" />
              <span>添加账号</span>
            </NButton>
            <router-link
              :to="{ path: '/settings', query: { tab: 'account' } }"
              class="account-dropdown-action"
              @click="showAccountDropdown = false"
            >
              <div class="i-carbon-add-alt" />
              <span>管理账号</span>
            </router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="sidebar-nav flex-1 overflow-y-auto px-3 py-4 space-y-1">
      <router-link
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150"
        :active-class="item.path === '/' ? '' : 'font-medium'"
        :style="{
          color: 'var(--theme-text)',
          opacity: '0.85',
        }"
        :data-nav="item.path"
      >
        <span class="nav-icon" :class="item.icon" />
        <span class="font-body">{{ item.label }}</span>
      </router-link>
    </nav>

    <!-- Token Display (All Users) -->
    <div v-if="userStore.token" class="border-t border-gray-200/40 px-3 py-2 dark:border-gray-700/40">
      <button
        class="w-full flex items-center justify-between rounded-xl px-3 py-2 transition-colors hover:bg-gray-100/50 dark:hover:bg-gray-700/50"
        @click="showTokenDropdown = !showTokenDropdown"
      >
        <div class="flex items-center gap-2">
          <div class="i-carbon-key text-sm" :style="{ color: 'var(--theme-primary)' }" />
          <span class="text-xs text-gray-500 font-medium dark:text-gray-400">我的 Token</span>
        </div>
        <div
          class="i-carbon-chevron-down text-gray-400 transition-transform duration-200"
          :class="{ 'rotate-180': showTokenDropdown }"
        />
      </button>
      <div
        v-show="showTokenDropdown"
        class="px-1 pt-2 transition-all"
      >
        <div class="mb-1 flex items-center justify-between">
          <button
            class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            :class="tokenVisible ? 'text-blue-500' : 'text-gray-500 dark:text-gray-400'"
            @click="tokenVisible = !tokenVisible"
          >
            <div :class="tokenVisible ? 'i-carbon-view-off' : 'i-carbon-view'" />
            <span>{{ tokenVisible ? '隐藏' : '显示' }}</span>
          </button>
          <button
            class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            :class="tokenCopied ? 'text-green-500' : 'text-gray-500 dark:text-gray-400'"
            @click="copyToken"
          >
            <div v-if="tokenCopied" class="i-carbon-checkmark" />
            <div v-else class="i-carbon-copy" />
            <span>{{ tokenCopied ? '已复制' : '复制' }}</span>
          </button>
        </div>
        <div class="break-all rounded-xl bg-gray-100/50 px-2 py-1.5 text-[10px] text-gray-600 font-mono dark:bg-gray-700/50 dark:text-gray-400">
          {{ tokenVisible ? userStore.token : '••••••••••••••••' }}
        </div>
      </div>
    </div>

    <!-- Footer Status -->
    <div class="sidebar-footer relative mt-auto p-4">
      <div class="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <div class="flex items-center gap-1.5">
          <div
            class="h-2 w-2 rounded-full"
            :class="[connectionStatus.color, { 'animate-pulse': connectionStatus.pulse }]"
          />
          <span>{{ connectionStatus.text }}</span>
        </div>
        <span>{{ uptime }}</span>
      </div>
      <div class="mt-1 flex flex-col gap-0.5 text-xs text-gray-400 font-mono">
        <div class="flex items-center justify-between">
          <span>{{ formattedTime }}</span>
        </div>
        <div class="flex items-center justify-between opacity-50">
          <div class="flex items-center gap-2">
            <span>Web v{{ version }}</span>
            <a
              href="https://github.com/liyangpengs/qq-farm-bot"
              target="_blank"
              rel="noopener noreferrer"
              title="开源地址"
              class="inline-flex items-center text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            >
              <div class="i-carbon-logo-github text-base" />
            </a>
          </div>
          <span v-if="serverVersion">Core v{{ serverVersion }}</span>
        </div>
      </div>
    </div>
  </aside>

  <!-- Overlay for mobile when sidebar is open -->
  <div
    v-if="showAccountDropdown || showUserDropdown"
    class="fixed inset-0 z-40 bg-transparent"
    @click="showAccountDropdown = false; showUserDropdown = false"
  />

  <AccountModal
    :show="showAccountModal"
    :edit-data="accountToEdit"
    @close="showAccountModal = false; accountToEdit = null"
    @saved="handleAccountSaved"
  />

  <RemarkModal
    :show="showRemarkModal"
    :account="accountToEdit"
    @close="showRemarkModal = false"
    @saved="handleAccountSaved"
  />
</template>

<style scoped>
.app-sidebar {
  color: var(--ui-ink);
  border-right: 1px solid var(--ui-border);
  background: rgba(250, 251, 247, 0.84);
  box-shadow:
    10px 0 32px rgba(55, 75, 61, 0.06),
    inset -1px 0 0 rgba(255, 255, 255, 0.84);
  -webkit-backdrop-filter: blur(22px) saturate(135%);
  backdrop-filter: blur(22px) saturate(135%);
}

.sidebar-brand {
  min-height: 62px;
  border-bottom: 1px solid var(--ui-border);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.brand-mark {
  width: 22px;
  height: 22px;
  flex: none;
  color: var(--ui-primary);
}

.sidebar-control {
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  color: var(--ui-ink);
  background: rgba(255, 255, 255, 0.56);
}

.sidebar-control:hover {
  border-color: var(--ui-border-strong);
  background: rgba(255, 255, 255, 0.82);
}

.sidebar-dropdown {
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  color: var(--ui-ink);
  background: var(--ui-surface-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    var(--ui-shadow-lg);
  -webkit-backdrop-filter: blur(18px) saturate(145%);
  backdrop-filter: blur(18px) saturate(145%);
}

.sidebar-footer {
  border-top: 1px solid var(--ui-border);
  background: rgba(242, 246, 240, 0.58);
}

nav a:hover {
  background: rgba(230, 241, 232, 0.76);
}

.nav-icon {
  width: 19px;
  height: 19px;
  flex: none;
  color: var(--ui-muted);
}

.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.3);
  border-radius: 2px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
}

.router-link-active {
  background: var(--ui-primary-soft) !important;
  color: var(--ui-primary) !important;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(67, 141, 99, 0.13) !important;
  border-radius: 8px;
  opacity: 1 !important;
}

.router-link-active .nav-icon {
  color: var(--ui-primary);
}

.router-link-exact-active {
  background: var(--ui-primary-soft) !important;
  color: var(--ui-primary) !important;
  font-weight: 600;
  box-shadow: inset 0 0 0 1px rgba(67, 141, 99, 0.13) !important;
  border-radius: 8px;
  opacity: 1 !important;
}

.router-link-exact-active .nav-icon {
  color: var(--ui-primary);
}

/* Dropdown active item */
.bg-green-50 {
  background-color: color-mix(in srgb, var(--theme-primary) 10%, transparent) !important;
}

.dark\:bg-green-900\/10 {
  background-color: color-mix(in srgb, var(--theme-primary) 15%, transparent) !important;
}

/* Farm avatar ring glow effect */
.farm-avatar-ring {
  transition: box-shadow 0.16s ease;
}

.farm-avatar-ring:hover {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-primary) 18%, transparent);
}

.admin-badge {
  color: #725d9e;
  background: var(--ui-violet-soft);
}

.admin-star {
  color: #8b6321;
  background: var(--ui-warning-soft);
}

.sidebar-menu-button {
  width: 100%;
  min-height: 34px;
  padding: 8px 12px;
  border-radius: 10px;
}

.sidebar-menu-button :deep(.n-button__content) {
  width: 100%;
  justify-content: flex-start;
  gap: 8px;
}

.account-dropdown-action {
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  color: var(--theme-primary);
  font-size: 14px;
  text-align: left;
  transition: background-color 0.15s ease;
}

.account-dropdown-action:hover {
  background: rgba(107, 114, 128, 0.08);
}
</style>
