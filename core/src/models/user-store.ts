export {};
/**
 * 用户存储 - 普通用户注册、登录、配额管理、时长降级
 */
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');
const security = require('./auth-security');
const cardStore = require('./card-store');

const USERS_FILE: string = getDataFile('users.json');

const BASE_QUOTA_ACCOUNTS: number = 1;
const DURATION_CARD_DAYS: number = 30;

interface UserRecord {
    id: string;
    username: string;
    password: string;
    role: 'user';
    createdAt: number;
    updatedAt: number;
    cards: string[];
    durationEnd: number;
}

interface UsersData {
    users: UserRecord[];
}

function normalizeUser(raw: any): UserRecord | null {
    if (!raw || typeof raw !== 'object' || !String(raw.username || '').trim()) return null;
    return {
        id: String(raw.id || ''),
        username: String(raw.username || '').trim(),
        password: String(raw.password || ''),
        role: 'user',
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt: Number(raw.updatedAt) || Date.now(),
        cards: Array.isArray(raw.cards) ? raw.cards.map(String) : [],
        durationEnd: Number(raw.durationEnd) || 0,
    };
}

function loadUsers(): UsersData {
    ensureDataDir();
    const data = readJsonFile(USERS_FILE, () => ({ users: [] }));
    const rawUsers = Array.isArray(data.users) ? data.users : [];
    return { users: rawUsers.map(normalizeUser).filter(Boolean) as UserRecord[] };
}

function saveUsers(data: UsersData): void {
    ensureDataDir();
    writeJsonFileAtomic(USERS_FILE, { users: data.users });
}

function genUserId(): string {
    return `u_${crypto.randomBytes(8).toString('hex')}`;
}

function findUserById(id: unknown): UserRecord | null {
    const uid = String(id || '');
    if (!uid) return null;
    return loadUsers().users.find(u => u.id === uid) || null;
}

function findUserByUsername(usernameRaw: unknown): UserRecord | null {
    const name = String(usernameRaw || '').trim();
    if (!name) return null;
    return loadUsers().users.find(u => u.username.toLowerCase() === name.toLowerCase()) || null;
}

function getUserPublic(user: UserRecord): any {
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        durationEnd: user.durationEnd,
    };
}

function computeCardBonus(userId: string): number {
    return cardStore.listCards().reduce((sum, card) => {
        if (card.redeemedBy !== userId) return sum;
        if (card.type === 'account' && card.status === 'active') return sum + card.maxAccounts;
        return sum;
    }, 0);
}

function computeMaxAccounts(user: UserRecord, usedAccounts: number): number {
    return BASE_QUOTA_ACCOUNTS + computeCardBonus(user.id);
}

function getQuota(userId: unknown, usedAccounts: number): any {
    const user = findUserById(userId);
    if (!user) return null;
    const cardBonus = computeCardBonus(user.id);
    const maxAccounts = BASE_QUOTA_ACCOUNTS + cardBonus;
    const durationActive = user.durationEnd > Date.now();
    const durationRemainingMs = durationActive ? Math.max(0, user.durationEnd - Date.now()) : 0;
    return {
        userId: user.id,
        maxAccounts,
        usedAccounts: Math.max(0, usedAccounts),
        remaining: Math.max(0, maxAccounts - Math.max(0, usedAccounts)),
        baseQuota: BASE_QUOTA_ACCOUNTS,
        cardBonus,
        durationActive,
        durationEnd: user.durationEnd,
        durationRemainingMs,
        exceeded: Math.max(0, Math.max(0, usedAccounts) - maxAccounts),
    };
}

function registerUser(usernameRaw: unknown, password: string, cardCodeRaw: unknown): { ok: boolean; user?: UserRecord; error?: string; code?: string } {
    const username = String(usernameRaw || '').trim();
    if (username.length < 3 || username.length > 32) {
        return { ok: false, error: '用户名长度需在 3-32 位之间', code: 'invalid_username' };
    }
    if (!/^\w+$/.test(username)) {
        return { ok: false, error: '用户名只能包含字母、数字、下划线', code: 'invalid_username' };
    }
    if (findUserByUsername(username)) {
        return { ok: false, error: '用户名已被注册', code: 'username_taken' };
    }

    const strength = security.validatePasswordStrength(password);
    if (!strength.valid) {
        return { ok: false, error: strength.errors[0] || '密码强度不足', code: 'weak_password' };
    }

    const cardCheck = cardStore.validateCard(cardCodeRaw);
    if (!cardCheck.ok || !cardCheck.card) {
        return { ok: false, error: cardCheck.error || '卡密无效', code: 'invalid_card' };
    }
    const card = cardCheck.card;

    const user: UserRecord = {
        id: genUserId(),
        username,
        password: security.hashPassword(password),
        role: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cards: [card.code],
        durationEnd: card.type === 'duration' ? Date.now() + Math.max(1, card.days || DURATION_CARD_DAYS) * 86400 * 1000 : 0,
    };

    const data = loadUsers();
    data.users.push(user);
    saveUsers(data);

    const redeem = cardStore.redeemCard(card.code, user.id);
    if (!redeem.ok) {
        const data2 = loadUsers();
        data2.users = data2.users.filter(u => u.id !== user.id);
        saveUsers(data2);
        return { ok: false, error: redeem.error || '卡密兑换失败', code: 'redeem_failed' };
    }
    return { ok: true, user };
}

function verifyLogin(usernameRaw: unknown, password: string): { ok: boolean; user?: UserRecord; error?: string } {
    const username = String(usernameRaw || '').trim();
    const user = findUserByUsername(username);
    if (!user) return { ok: false, error: '用户名或密码错误' };
    if (!security.verifyPassword(password, user.password)) {
        return { ok: false, error: '用户名或密码错误' };
    }
    return { ok: true, user };
}

function redeemCardForUser(userId: unknown, cardCodeRaw: unknown): { ok: boolean; error?: string; quota?: any; user?: UserRecord } {
    const user = findUserById(userId);
    if (!user) return { ok: false, error: '用户不存在' };
    const cardCheck = cardStore.validateCard(cardCodeRaw);
    if (!cardCheck.ok || !cardCheck.card) {
        return { ok: false, error: cardCheck.error || '卡密无效' };
    }
    const card = cardCheck.card;

    const redeem = cardStore.redeemCard(card.code, user.id);
    if (!redeem.ok) return { ok: false, error: redeem.error || '卡密兑换失败' };

    const data = loadUsers();
    const target = data.users.find(u => u.id === user.id);
    if (target) {
        if (!target.cards.includes(card.code)) target.cards.push(card.code);
        if (card.type === 'duration') {
            const base = target.durationEnd > Date.now() ? target.durationEnd : Date.now();
            target.durationEnd = base + Math.max(1, card.days || DURATION_CARD_DAYS) * 86400 * 1000;
        }
        target.updatedAt = Date.now();
        saveUsers(data);
    }
    return { ok: true, user: target || user };
}

function changeUserPassword(userId: unknown, oldPassword: string, newPassword: string): { ok: boolean; error?: string } {
    const user = findUserById(userId);
    if (!user) return { ok: false, error: '用户不存在' };
    if (!security.verifyPassword(oldPassword, user.password)) {
        return { ok: false, error: '当前密码错误' };
    }
    const strength = security.validatePasswordStrength(newPassword);
    if (!strength.valid) {
        return { ok: false, error: strength.errors[0] || '密码强度不足' };
    }
    const data = loadUsers();
    const target = data.users.find(u => u.id === user.id);
    if (target) {
        target.password = security.hashPassword(newPassword);
        target.updatedAt = Date.now();
        saveUsers(data);
    }
    return { ok: true };
}

function listUsers(): any[] {
    return loadUsers().users.map(getUserPublic);
}

function setUserDuration(userId: unknown, days: number): { ok: boolean; error?: string } {
    const user = findUserById(userId);
    if (!user) return { ok: false, error: '用户不存在' };
    const data = loadUsers();
    const target = data.users.find(u => u.id === user.id);
    if (target) {
        const base = target.durationEnd > Date.now() ? target.durationEnd : Date.now();
        target.durationEnd = base + Math.max(1, Math.floor(days)) * 86400 * 1000;
        target.updatedAt = Date.now();
        saveUsers(data);
    }
    return { ok: true };
}

function reconcileExpired(): string[] {
    const now = Date.now();
    const data = loadUsers();
    const expiredIds: string[] = [];
    let changed = false;
    for (const user of data.users) {
        if (user.durationEnd > 0 && user.durationEnd <= now) {
            expiredIds.push(user.id);
            user.durationEnd = 0;
            changed = true;
        }
    }
    if (changed) saveUsers(data);
    return expiredIds;
}

module.exports = {
    BASE_QUOTA_ACCOUNTS,
    DURATION_CARD_DAYS,
    loadUsers,
    findUserById,
    findUserByUsername,
    getUserPublic,
    computeMaxAccounts,
    getQuota,
    registerUser,
    verifyLogin,
    redeemCardForUser,
    changeUserPassword,
    listUsers,
    setUserDuration,
    reconcileExpired,
};
