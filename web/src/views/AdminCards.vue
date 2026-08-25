<script setup lang="ts">
import { NButton, NCard, NDataTable, NTag, useDialog } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { computed, onMounted, ref, h } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useToastStore } from '@/stores/toast'
import { copyTextToClipboard } from '@/utils/clipboard'

const toastStore = useToastStore()
const dialog = useDialog()

const cards = ref<any[]>([])
const stats = ref<any>({ total: 0, used: 0, active: 0, disabled: 0 })

const genType = ref('account')
const genCount = ref(10)
const genMaxAccounts = ref(1)
const genDays = ref(30)

const search = ref('')
const statusFilter = ref('all')
const typeFilter = ref('all')
const checkedKeys = ref<string[]>([])
const lastGenerated = ref<string[]>([])

async function loadCards() {
  const res = await api.get('/api/admin/cards')
  if (res.data.ok) {
    cards.value = res.data.data.cards
    stats.value = res.data.data.stats
  }
}

async function copyText(text: string, tip: string) {
  if (!text) return
  const ok = await copyTextToClipboard(text)
  if (ok) {
    toastStore.success(tip)
  }
  else {
    toastStore.error('复制失败，请手动复制')
  }
}

function cardStatus(card: any): string {
  if (card.status === 'disabled') return 'disabled'
  if (card.redeemedAt) return 'used'
  return 'active'
}

async function handleGenerate() {
  if (!genCount.value || genCount.value < 1) {
    toastStore.warning('请输入生成数量')
    return
  }
  try {
    const res = await api.post('/api/admin/cards/generate', {
      type: genType.value,
      count: genCount.value,
      maxAccounts: genMaxAccounts.value,
      days: genDays.value,
    })
    if (res.data.ok) {
      const codes = res.data.data.cards.map((c: any) => c.code)
      lastGenerated.value = codes
      cards.value = res.data.data.cards
      stats.value = res.data.data.stats
      toastStore.success(`已生成 ${codes.length} 张卡密`)
      copyText(codes.join('\n'), `已复制最近生成的 ${codes.length} 张卡密`)
    }
    else {
      toastStore.error(res.data.error || '生成失败')
    }
  }
  catch (e: any) {
    toastStore.error(e.response?.data?.error || e.message || '生成失败')
  }
}

function copySelected() {
  const selected = cards.value.filter(c => checkedKeys.value.includes(c.code))
  if (!selected.length) {
    toastStore.warning('请先勾选要复制的卡密')
    return
  }
  copyText(selected.map(c => c.code).join('\n'), `已复制 ${selected.length} 张卡密`)
}

function copyLatest() {
  if (!lastGenerated.value.length) {
    toastStore.warning('尚未生成过卡密')
    return
  }
  copyText(lastGenerated.value.join('\n'), `已复制最近生成的 ${lastGenerated.value.length} 张卡密`)
}

function toggleStatus(card: any) {
  const next = card.status === 'disabled' ? 'active' : 'disabled'
  dialog.info({
    title: '确认操作',
    content: `确定要${next === 'disabled' ? '停用' : '启用'}卡密 ${card.code} 吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const res = await api.post(`/api/admin/cards/${encodeURIComponent(card.code)}/status`, { status: next })
        if (res.data.ok) {
          card.status = next
          toastStore.success('操作成功')
        }
      }
      catch (e: any) {
        toastStore.error(e.response?.data?.error || e.message || '操作失败')
      }
    },
  })
}

function batchToggle() {
  const selected = cards.value.filter(c => checkedKeys.value.includes(c.code))
  if (!selected.length) {
    toastStore.warning('请先勾选卡密')
    return
  }
  const targetDisabled = selected.some(c => cardStatus(c) === 'active')
  const label = targetDisabled ? '停用' : '启用'
  dialog.info({
    title: '批量操作',
    content: `确定要${label}选中的 ${selected.length} 张卡密吗？`,
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      let failed = 0
      for (const c of selected) {
        try {
          const r = await api.post(`/api/admin/cards/${encodeURIComponent(c.code)}/status`, { status: targetDisabled ? 'disabled' : 'active' })
          if (!r.data.ok) failed++
        }
        catch {
          failed++
        }
      }
      await loadCards()
      checkedKeys.value = []
      if (failed) toastStore.warning(`已完成，${failed} 张操作失败`)
      else toastStore.success(`已${label} ${selected.length} 张卡密`)
    },
  })
}

const filteredCards = computed(() => {
  const s = search.value.trim().toLowerCase()
  return cards.value.filter((c) => {
    if (s && !c.code.toLowerCase().includes(s)) return false
    if (statusFilter.value !== 'all' && cardStatus(c) !== statusFilter.value) return false
    if (typeFilter.value !== 'all' && c.type !== typeFilter.value) return false
    return true
  })
})

function fmtTime(t?: number | null): string {
  if (!t) return '-'
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const columns = computed<DataTableColumns<any>>(() => [
  { type: 'selection' },
  { title: '卡密', key: 'code', width: 220, render: (row: any) => h('span', { class: 'font-mono text-xs whitespace-nowrap' }, row.code) },
  { title: '类型', key: 'type', width: 80, render: (row: any) => h(NTag, { type: row.type === 'duration' ? 'warning' : 'info', size: 'small' }, { default: () => row.type === 'duration' ? '时长' : '额度' }) },
  {
    title: '参数',
    key: 'param',
    width: 88,
    render: (row: any) => h('span', { class: 'text-xs' }, row.type === 'duration' ? `${row.days} 天` : `${row.maxAccounts} 账号`),
  },
  { title: '状态', key: 'status', width: 84, render: (row: any) => h(NTag, { type: row.status === 'active' ? (row.redeemedAt ? 'info' : 'success') : 'default', size: 'small' }, { default: () => row.status === 'disabled' ? '已停用' : row.redeemedAt ? '已使用' : '未使用' }) },
  { title: '生成时间', key: 'createdAt', width: 132, render: (row: any) => h('span', { class: 'text-xs' }, fmtTime(row.createdAt)) },
  { title: '兑换时间', key: 'redeemedAt', width: 132, render: (row: any) => h('span', { class: 'text-xs' }, fmtTime(row.redeemedAt)) },
  {
    title: '绑定用户',
    key: 'redeemedBy',
    width: 120,
    render: (row: any) => h('span', { class: 'text-xs text-coolgray-9' }, row.redeemedBy || '-'),
  },
  {
    title: '操作',
    key: 'actions',
    width: 140,
    render: (row: any) => h('div', { class: 'flex items-center gap-1' }, [
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => copyText(row.code, '已复制卡密') }, { default: () => '复制' }),
      h(NButton, { size: 'tiny', quaternary: true, onClick: () => toggleStatus(row) }, { default: () => row.status === 'disabled' ? '启用' : '停用' }),
    ]),
  },
])

onMounted(loadCards)
</script>

<template>
  <div class="flex flex-col gap-4">
    <section class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold">卡密管理</h1>
        <p class="text-sm text-coolgray-9">
          生成与管理分账号额度卡密和时长卡密
        </p>
      </div>
    </section>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <NCard size="small">
        <div class="text-xs text-coolgray-9">
          总计
        </div>
        <div class="mt-1 text-xl font-semibold">
          {{ stats.total }}
        </div>
      </NCard>
      <NCard size="small">
        <div class="text-xs text-coolgray-9">
          未使用
        </div>
        <div class="mt-1 text-xl font-semibold text-green-6">
          {{ stats.active }}
        </div>
      </NCard>
      <NCard size="small">
        <div class="text-xs text-coolgray-9">
          已使用
        </div>
        <div class="mt-1 text-xl font-semibold text-blue-6">
          {{ stats.used }}
        </div>
      </NCard>
      <NCard size="small">
        <div class="text-xs text-coolgray-9">
          已停用
        </div>
        <div class="mt-1 text-xl font-semibold text-red-6">
          {{ stats.disabled }}
        </div>
      </NCard>
    </div>

    <NCard title="生成卡密" size="small">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <label class="text-xs text-coolgray-9">卡密类型</label>
          <BaseSelect
            v-model="genType"
            :options="[
              { label: '分账号额度卡密', value: 'account' },
              { label: '时长卡密', value: 'duration' },
            ]"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <label class="text-xs text-coolgray-9">生成数量</label>
          <BaseInput v-model="genCount" type="number" min="1" max="500" />
        </div>
        <div v-if="genType === 'account'" class="flex min-w-0 flex-1 flex-col gap-1">
          <label class="text-xs text-coolgray-9">账号额度</label>
          <BaseInput v-model="genMaxAccounts" type="number" min="1" />
        </div>
        <div v-else class="flex min-w-0 flex-1 flex-col gap-1">
          <label class="text-xs text-coolgray-9">时长（天）</label>
          <BaseInput v-model="genDays" type="number" min="1" />
        </div>
        <BaseButton variant="primary" @click="handleGenerate">
          生成
        </BaseButton>
      </div>
    </NCard>

    <NCard title="卡密列表" size="small">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <BaseInput v-model="search" placeholder="搜索卡密..." clearable class="!w-52" />
        <BaseSelect
          v-model="statusFilter"
          class="!w-32"
          :options="[
            { label: '全部状态', value: 'all' },
            { label: '未使用', value: 'active' },
            { label: '已使用', value: 'used' },
            { label: '已停用', value: 'disabled' },
          ]"
        />
        <BaseSelect
          v-model="typeFilter"
          class="!w-32"
          :options="[
            { label: '全部类型', value: 'all' },
            { label: '额度卡密', value: 'account' },
            { label: '时长卡密', value: 'duration' },
          ]"
        />
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <BaseButton size="sm" variant="outline" @click="copyLatest">
            复制最新
          </BaseButton>
          <BaseButton size="sm" variant="outline" @click="copySelected">
            复制选中{{ checkedKeys.length ? `(${checkedKeys.length})` : '' }}
          </BaseButton>
          <BaseButton size="sm" variant="secondary" @click="batchToggle">
            批量启停
          </BaseButton>
        </div>
      </div>
      <NDataTable
        :columns="columns"
        :data="filteredCards"
        v-model:checked-row-keys="checkedKeys"
        :pagination="{ pageSize: 20 }"
        :scroll-x="1080"
        :bordered="false"
        :size="'small'"
        :row-key="(row: any) => row.code"
      />
    </NCard>
  </div>
</template>
