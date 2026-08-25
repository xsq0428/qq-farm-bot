export {};
/**
 * 卡密存储 - 分账号额度卡密与时长卡密
 */
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');

const CARDS_FILE: string = getDataFile('cards.json');

const CARD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CARD_CODE_LENGTH = 16;

interface CardRecord {
    code: string;
    type: 'account' | 'duration';
    maxAccounts: number;
    days: number;
    createdAt: number;
    redeemedBy: string | null;
    redeemedAt: number | null;
    status: 'active' | 'disabled';
}

interface CardsData {
    cards: CardRecord[];
}

function normalizeCard(raw: any): CardRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const type = String(raw.type || '') === 'duration' ? 'duration' : 'account';
    return {
        code: String(raw.code || '').trim().toUpperCase(),
        type,
        maxAccounts: Math.max(0, Number.parseInt(raw.maxAccounts, 10) || 0),
        days: Math.max(0, Number.parseInt(raw.days, 10) || 0),
        createdAt: Number(raw.createdAt) || Date.now(),
        redeemedBy: raw.redeemedBy ? String(raw.redeemedBy) : null,
        redeemedAt: raw.redeemedAt ? Number(raw.redeemedAt) : null,
        status: String(raw.status || '') === 'disabled' ? 'disabled' : 'active',
    };
}

function loadCards(): CardsData {
    ensureDataDir();
    const data = readJsonFile(CARDS_FILE, () => ({ cards: [] }));
    const rawCards = Array.isArray(data.cards) ? data.cards : [];
    return { cards: rawCards.map(normalizeCard).filter(Boolean) as CardRecord[] };
}

function saveCards(data: CardsData): void {
    ensureDataDir();
    writeJsonFileAtomic(CARDS_FILE, { cards: data.cards });
}

function generateCode(): string {
    const bytes = crypto.randomBytes(CARD_CODE_LENGTH);
    let code = '';
    for (let i = 0; i < CARD_CODE_LENGTH; i++) {
        code += CARD_CODE_ALPHABET[bytes[i] % CARD_CODE_ALPHABET.length];
    }
    // 分组显示：XXXX-XXXX-XXXX-XXXX
    return code.replace(/(.{4})(?=.)/g, '$1-');
}

function generateCards(type: 'account' | 'duration', param: number, count: number): CardRecord[] {
    const data = loadCards();
    const existing = new Set(data.cards.map(c => c.code));
    const created: CardRecord[] = [];
    let generated = 0;
    const maxTries = count * 50;
    while (generated < count && maxTries > 0) {
        const code = generateCode();
        if (existing.has(code)) continue;
        const card: CardRecord = {
            code,
            type,
            maxAccounts: type === 'account' ? Math.max(1, Math.floor(param)) : 0,
            days: type === 'duration' ? Math.max(1, Math.floor(param)) : 0,
            createdAt: Date.now(),
            redeemedBy: null,
            redeemedAt: null,
            status: 'active',
        };
        data.cards.push(card);
        existing.add(code);
        created.push(card);
        generated++;
    }
    saveCards(data);
    return created;
}

function findCard(codeRaw: unknown): CardRecord | null {
    const code = String(codeRaw || '').trim().toUpperCase().replace(/[-\s]/g, '');
    if (!code) return null;
    const data = loadCards();
    return data.cards.find(c => c.code.replace(/[-\s]/g, '') === code) || null;
}

function validateCard(codeRaw: unknown): { ok: boolean; card?: CardRecord; error?: string } {
    const card = findCard(codeRaw);
    if (!card) return { ok: false, error: '卡密不存在' };
    if (card.status === 'disabled') return { ok: false, error: '卡密已停用' };
    if (card.redeemedAt && card.redeemedBy) return { ok: false, error: '卡密已被使用' };
    return { ok: true, card };
}

function redeemCard(codeRaw: unknown, userId: string): { ok: boolean; card?: CardRecord; error?: string } {
    const data = loadCards();
    const code = String(codeRaw || '').trim().toUpperCase().replace(/[-\s]/g, '');
    const card = data.cards.find(c => c.code.replace(/[-\s]/g, '') === code);
    if (!card) return { ok: false, error: '卡密不存在' };
    if (card.status === 'disabled') return { ok: false, error: '卡密已停用' };
    if (card.redeemedAt && card.redeemedBy) return { ok: false, error: '卡密已被使用' };
    card.redeemedBy = String(userId);
    card.redeemedAt = Date.now();
    saveCards(data);
    return { ok: true, card };
}

function setCardStatus(codeRaw: unknown, status: 'active' | 'disabled'): { ok: boolean; error?: string } {
    const data = loadCards();
    const code = String(codeRaw || '').trim().toUpperCase().replace(/[-\s]/g, '');
    const card = data.cards.find(c => c.code.replace(/[-\s]/g, '') === code);
    if (!card) return { ok: false, error: '卡密不存在' };
    card.status = status;
    saveCards(data);
    return { ok: true };
}

function listCards(): CardRecord[] {
    return loadCards().cards;
}

function getStats(): { total: number; used: number; active: number; disabled: number } {
    const cards = loadCards().cards;
    return {
        total: cards.length,
        used: cards.filter(c => !!c.redeemedAt).length,
        active: cards.filter(c => c.status === 'active' && !c.redeemedAt).length,
        disabled: cards.filter(c => c.status === 'disabled').length,
    };
}

module.exports = {
    loadCards,
    generateCards,
    findCard,
    validateCard,
    redeemCard,
    setCardStatus,
    listCards,
    getStats,
};
