<script setup lang="ts">
import { NCard, NProgress, NTag } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useToastStore } from '@/stores/toast'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const toastStore = useToastStore()
const { userInfo } = storeToRefs(userStore)

const quota = ref<any>(null)
const cardCode = ref('')
const redeeming = ref(false)

const dateFormat = (ts: number) => {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const usagePercent = computed(() => {
  if (!quota.value || !quota.value.maxAccounts) return 0
  return Math.min(100, Math.round((quota.value.usedAccounts / quota.value.maxAccounts) * 100))
})

const remainingText = computed(() => {
  if (quota.value) {
    if (quota.value.exceeded > 0) return `已超出 ${quota.value.exceeded} 个`
    return `剩余 ${quota.value.remaining} 个`
  }
  return ''
})

async function loadQuota() {
  const res = await api.get('/api/user/quota')
  if (res.data.ok)
    quota.value = res.data.data
}

async function handleRedeem() {
  if (!cardCode.value.trim()) {
    toastStore.warning('请输入卡密')
    return
  }
  redeeming.value = true
  try {
    const res = await userStore.redeemCard(cardCode.value.trim())
    if (res.ok) {
      quota.value = res.data.quota
      cardCode.value = ''
      toastStore.success('卡密兑换成功')
    }
    else {
      toastStore.error(res.error || '兑换失败')
    }
  }
  catch (e: any) {
    toastStore.error(e.response?.data?.error || e.message || '操作异常')
  }
  finally {
    redeeming.value = false
  }
}

onMounted(loadQuota)
</script>

<template>
  <div class="flex flex-col gap-4">
    <section class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">我的账户</h1>
        <p class="text-sm text-coolgray-9">
          管理账号配额与卡密
        </p>
      </div>
    </section>

    <NCard title="账号配额" size="small">
      <template #header-extra>
        <NTag v-if="quota" type="info" size="small">
          {{ dateFormat(quota.durationEnd) }}
        </NTag>
      </template>

      <div v-if="quota" class="flex flex-col gap-4">
        <div class="flex items-center gap-4">
          <NProgress
            :percentage="usagePercent"
            :height="12"
            :show-indicator="false"
            :color="quota.exceeded > 0 ? '#c95f66' : undefined"
            style="flex: 1"
          />
          <div class="flex-1 text-right text-sm">
            <span class="font-semibold">{{ quota.usedAccounts }}</span>
            <span class="text-sm text-coolgray-9"> / {{ quota.maxAccounts }} 个账号</span>
            <div class="text-xs text-coolgray-9">
              {{ remainingText }}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-lg bg-coolgray-2 p-3">
            <div class="text-xs text-coolgray-9">
              基础额度
            </div>
            <div class="mt-1 text-base font-semibold">
              {{ quota.baseQuota }} 个
            </div>
          </div>
          <div class="rounded-lg bg-coolgray-2 p-3">
            <div class="text-xs text-coolgray-9">
              额度卡加成
            </div>
            <div class="mt-1 text-base font-semibold">
              + {{ quota.cardBonus }} 个
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between rounded-lg bg-coolgray-2 px-3 py-2 text-sm">
          <span class="text-coolgray-9">会员有效期</span>
          <span class="font-medium">{{ quota.durationActive ? dateFormat(quota.durationEnd) : '未开通' }}</span>
        </div>
      </div>
    </NCard>

    <NCard title="激活卡密" size="small">
      <p class="mb-3 text-xs text-coolgray-9">
        分账号额度卡密可增加账号上限，时长卡密可开通会员有效期。一张卡密仅可使用一次。
      </p>
      <div class="flex items-center gap-2">
        <BaseInput
          v-model="cardCode"
          type="text"
          placeholder="请输入卡密，如 AAAA-BBBB-CCCC-DDDD"
          class="flex-1"
        />
        <BaseButton variant="primary" :loading="redeeming" :disabled="!cardCode.trim()" @click="handleRedeem">
          兑换
        </BaseButton>
      </div>
    </NCard>

    <NCard title="账户信息" size="small">
      <div class="flex flex-col gap-2 text-sm">
        <div class="flex justify-between">
          <span class="text-coolgray-9">用户名</span>
          <span class="font-medium">{{ userInfo?.username }}</span>
        </div>
        <div class="flex justify-between">
          <span class="text-coolgray-9">角色</span>
          <NTag type="warning" size="small">
            普通用户
          </NTag>
        </div>
        <div class="flex justify-between">
          <span class="text-coolgray-9">注册时间</span>
          <span class="font-medium">{{ dateFormat(userInfo?.createdAt || 0) }}</span>
        </div>
      </div>
    </NCard>
  </div>
</template>
