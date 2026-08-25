import type { NextFunction, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const crypto = require('node:crypto');
const store = require('../../models/store');
const { normalizeAccountRef, resolveAccountId } = require('../../services/account-resolver');

interface AuthenticatedRequest extends Request {
    adminToken?: string;
    authSession?: { role: 'admin' | 'user'; userId?: string };
}

function getClientIp(req: Request): string {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return String(cfIp).trim();
    const realIp = req.headers['x-real-ip'];
    if (realIp) return String(realIp).trim();
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const first = String(forwarded).split(',').map(item => item.trim()).find(Boolean);
        if (first) return first;
    }
    const address = req.ip || (req as any).connection?.remoteAddress || req.socket?.remoteAddress;
    return String(address || 'unknown').replace(/^::ffff:/, '');
}

const issueToken = (): string => crypto.randomBytes(24).toString('hex');

function createAuthRequired(ctx: AdminContext) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        const token = String(req.headers['x-admin-token'] || '');
        const session = token ? ctx.tokens.get(token) : undefined;
        if (!token || !session) {
            res.status(401).json({ ok: false, error: 'Unauthorized' });
            return;
        }
        req.adminToken = token;
        req.authSession = { role: session.role, userId: session.userId };
        next();
    };
}

function createAdminRequired(ctx: AdminContext) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        if (!req.authSession || req.authSession.role !== 'admin') {
            res.status(403).json({ ok: false, error: 'Forbidden: admin only' });
            return;
        }
        next();
    };
}

function getAuthSession(req: Request): { role: 'admin' | 'user'; userId?: string } | null {
    return (req as AuthenticatedRequest).authSession || null;
}

function isUserOwnerOfAccount(session: { role: 'admin' | 'user'; userId?: string } | null, account: any): boolean {
    if (!session) return false;
    if (session.role === 'admin') return true;
    const uid = String(session.userId || '');
    if (!uid) return false;
    return String((account && account.userId) || '') === uid;
}

function getAccountList(ctx: AdminContext, userId?: string): any[] {
    let list: any[] = [];
    try {
        if (ctx.provider && typeof ctx.provider.getAccounts === 'function') {
            const data = ctx.provider.getAccounts();
            if (Array.isArray(data?.accounts)) list = data.accounts;
        }
    } catch {
        // Fall back to persistent storage.
    }
    if (!list.length) {
        const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
        list = Array.isArray(data.accounts) ? data.accounts : [];
    }
    if (userId) {
        return list.filter((account: any) => String((account && account.userId) || '') === String(userId));
    }
    return list;
}

function getAccountIds(ctx: AdminContext, userId?: string): string[] {
    return getAccountList(ctx, userId).map((account: any) => String(account.id || '')).filter(Boolean);
}

function assertAccountAccess(session: { role: 'admin' | 'user'; userId?: string } | null, account: any): boolean {
    return isUserOwnerOfAccount(session, account);
}

function createAccountOwnershipGuard(ctx: AdminContext) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        const session = getAuthSession(req);
        if (!session) {
            res.status(401).json({ ok: false, error: 'Unauthorized' });
            return;
        }
        if (session.role === 'admin') return next();
        const rawRef = req.headers['x-account-id'];
        const input = normalizeAccountRef(rawRef);
        if (!input || input === 'all') {
            // 无账号上下文：user 只能访问自己的，all 由后续逻辑基于 userId 过滤
            return next();
        }
        const accounts = getAccountList(ctx, session.userId);
        if (!accounts.length) {
            res.status(403).json({ ok: false, error: '无权访问该账号' });
            return;
        }
        const target = resolveAccountId(accounts, input);
        if (!target) {
            res.status(403).json({ ok: false, error: '无权访问该账号' });
            return;
        }
        next();
    };
}

const isSoftRuntimeError = (err: any): boolean => {
    const message = String(err?.message || '');
    return message === '账号未运行' || message === 'API Timeout';
};

function handleApiError(res: Response, err: any): void {
    if (isSoftRuntimeError(err)) {
        res.json({ ok: false, error: err.message });
        return;
    }
    res.status(500).json({ ok: false, error: err.message });
}

function resolveAccId(ctx: AdminContext, rawRef: any): string {
    const input = normalizeAccountRef(rawRef);
    if (!input) return '';
    if (ctx.provider && typeof ctx.provider.resolveAccountId === 'function') {
        const resolvedByProvider = normalizeAccountRef(ctx.provider.resolveAccountId(input));
        if (resolvedByProvider) return resolvedByProvider;
    }
    return resolveAccountId(getAccountList(ctx), input) || input;
}

function getAccId(ctx: AdminContext, req: Request): string {
    return resolveAccId(ctx, req.headers['x-account-id']);
}

function buildKnownFriendGidSettings(accountId: string): {
    knownFriendGids: any[];
    knownFriendGidSyncCooldownSec: number;
    friendsListCacheTtlSec: number;
} {
    return {
        knownFriendGids: store.getKnownFriendGids ? store.getKnownFriendGids(accountId) : [],
        knownFriendGidSyncCooldownSec: store.getKnownFriendGidSyncCooldownSec
            ? store.getKnownFriendGidSyncCooldownSec(accountId)
            : 600,
        friendsListCacheTtlSec: store.getFriendsListCacheTtlSec
            ? store.getFriendsListCacheTtlSec(accountId)
            : 60,
    };
}

module.exports = {
    getClientIp,
    issueToken,
    createAuthRequired,
    createAdminRequired,
    createAccountOwnershipGuard,
    getAuthSession,
    isUserOwnerOfAccount,
    assertAccountAccess,
    getAccountList,
    getAccountIds,
    isSoftRuntimeError,
    handleApiError,
    resolveAccId,
    getAccId,
    buildKnownFriendGidSettings,
};
