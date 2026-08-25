import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const { version } = require('../../../package.json');
const { getRuntimeConfig } = require('../../config/config');
const { getSchedulerRegistrySnapshot } = require('../../services/scheduler');
const { createModuleLogger } = require('../../services/logger');
const adminStore = require('../../models/admin-store');
const userStore = require('../../models/user-store');
const cardStore = require('../../models/card-store');

const {
    getClientIp,
    issueToken,
    createAuthRequired,
    createAdminRequired,
    createAccountOwnershipGuard,
    getAuthSession,
    getAccountList,
    getAccId,
    handleApiError,
} = require('./middleware');

const adminLogger = createModuleLogger('admin');

function mountAuthRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);
    const adminRequired = createAdminRequired(ctx);

    // API: 开放注册（需卡密）
    app.post('/api/register', (req: Request, res: Response) => {
        const { username, password, cardCode } = req.body || {};
        if (!username || !password || !cardCode) {
            return res.status(400).json({ ok: false, error: '请提供用户名、密码和卡密' });
        }
        const result = userStore.registerUser(username, password, cardCode);
        if (!result.ok) {
            return res.status(400).json({ ok: false, error: result.error, code: result.code });
        }
        adminLogger.info('新用户注册', { username });
        const token = issueToken();
        ctx.tokens.set(token, { role: 'user', userId: result.user!.id });
        const publicUser = userStore.getUserPublic(result.user!);
        return res.json({
            ok: true,
            data: {
                token,
                role: 'user',
                user: publicUser,
                quota: userStore.getQuota(result.user!.id, 0),
            },
        });
    });

    app.post('/api/login', (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(401).json({ ok: false, error: '请输入用户名和密码' });
        }

        const clientIp = getClientIp(req);

        // 管理员登录
        if (username === 'admin') {
            const result = adminStore.validateAdmin(username, password, clientIp);
            if (result?.error) {
                const statusCode = result.error === 'rate_limit' ? 429 : result.error === 'locked' ? 423 : 401;
                adminLogger.warn('登录失败', { username, error: result.error, ip: clientIp });
                return res.status(statusCode).json({
                    ok: false,
                    error: result.message,
                    errorType: result.error,
                    remainingMs: result.remainingMs,
                });
            }
            const token = issueToken();
            ctx.tokens.set(token, { role: 'admin' });
            adminLogger.info('超级管理员登录成功', { username: result.username, ip: clientIp });
            return res.json({
                ok: true,
                data: {
                    token,
                    role: 'admin',
                    user: { username: result.username },
                    mustChangePassword: result.mustChangePassword === true,
                },
            });
        }

        // 普通用户登录
        const userResult = userStore.verifyLogin(username, password);
        if (userResult.ok && userResult.user) {
            const token = issueToken();
            ctx.tokens.set(token, { role: 'user', userId: userResult.user.id });
            return res.json({
                ok: true,
                data: {
                    token,
                    role: 'user',
                    user: userStore.getUserPublic(userResult.user),
                    quota: userStore.getQuota(userResult.user.id, 0),
                },
            });
        }

        adminLogger.warn('登录失败', { username, error: 'invalid_credentials', ip: clientIp });
        return res.status(401).json({ ok: false, error: '用户名或密码错误', errorType: 'invalid_credentials' });
    });

    app.post('/api/user/change-password', authRequired, (req: Request, res: Response) => {
        const { oldPassword, newPassword } = req.body || {};
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }
        const session = getAuthSession(req);
        if (session && session.role === 'user' && session.userId) {
            const result = userStore.changeUserPassword(session.userId, String(oldPassword), String(newPassword));
            if (result.ok) ctx.tokens.clear();
            return res.json(result);
        }
        const result = adminStore.changePassword(String(oldPassword), String(newPassword));
        if (result.ok) ctx.tokens.clear();
        return res.json(result);
    });

    app.get('/api/ping', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/game-version', (_req: Request, res: Response) => {
        res.json({ ok: true, clientVersion: getRuntimeConfig().clientVersion, botVersion: version });
    });

    app.use('/api', (req: Request, res: Response, next: any) => {
        if (req.path === '/login' || req.path === '/register') return next();
        return authRequired(req, res, next);
    });

    // 账号归属守卫：普通用户只能操作用 x-account-id 指定的、属于自己的账号。
    app.use('/api', createAccountOwnershipGuard(ctx));

    app.get('/api/auth/validate', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { valid: true } });
    });

    app.get('/api/scheduler', async (req: Request, res: Response) => {
        try {
            const id = getAccId(ctx, req);
            if (ctx.provider && typeof ctx.provider.getSchedulerStatus === 'function') {
                const data = await ctx.provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({
                ok: true,
                data: {
                    runtime: getSchedulerRegistrySnapshot(),
                    worker: null,
                    workerError: 'DataProvider does not support scheduler status',
                },
            });
        } catch (e: any) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        const token = (req as any).adminToken;
        if (token) ctx.tokens.delete(token);
        if (ctx.io && token) {
            for (const socket of ctx.io.sockets.sockets.values()) {
                if (String((socket.data as any).adminToken || '') === String(token)) socket.disconnect(true);
            }
        }
        res.json({ ok: true });
    });

    app.get('/api/user/me', authRequired, (req: Request, res: Response) => {
        const session = getAuthSession(req);
        if (session && session.role === 'user' && session.userId) {
            const user = userStore.findUserById(session.userId);
            if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
            const usedAccounts = userStore.getQuota(session.userId, getAccountList(ctx, session.userId).length);
            return res.json({ ok: true, data: { ...userStore.getUserPublic(user), quota: usedAccounts, role: 'user' } });
        }
        res.json({ ok: true, data: adminStore.getAdminInfo() });
    });

    // API: 获取当前用户配额
    app.get('/api/user/quota', authRequired, (req: Request, res: Response) => {
        const session = getAuthSession(req);
        if (session && session.role === 'user' && session.userId) {
            const usedAccounts = userStore.getQuota(session.userId, getAccountList(ctx, session.userId).length);
            return res.json({ ok: true, data: usedAccounts });
        }
        res.json({ ok: true, data: { role: 'admin', unlimited: true } });
    });

    // API: 兑换卡密（当前用户）
    app.post('/api/user/redeem-card', authRequired, (req: Request, res: Response) => {
        const session = getAuthSession(req);
        if (!session || session.role !== 'user' || !session.userId) {
            return res.status(403).json({ ok: false, error: '仅普通用户可兑换卡密' });
        }
        const { cardCode } = req.body || {};
        if (!cardCode) return res.status(400).json({ ok: false, error: '缺少卡密' });
        const result = userStore.redeemCardForUser(session.userId, cardCode);
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        const usedAccounts = userStore.getQuota(session.userId, getAccountList(ctx, session.userId).length);
        return res.json({ ok: true, data: { user: userStore.getUserPublic(result.user!), quota: usedAccounts } });
    });

    // API: 卡密列表统计（管理员）
    app.get('/api/admin/cards', adminRequired, (_req: Request, res: Response) => {
        const cards = cardStore.listCards();
        res.json({ ok: true, data: { cards, stats: cardStore.getStats() } });
    });

    // API: 生成卡密（管理员）
    app.post('/api/admin/cards/generate', adminRequired, (req: Request, res: Response) => {
        const { type, count, maxAccounts, days } = req.body || {};
        const cardType = String(type || '') === 'duration' ? 'duration' : 'account';
        const numCount = Math.max(1, Math.min(500, Number.parseInt(count, 10) || 1));
        const param = cardType === 'duration'
            ? Math.max(1, Number.parseInt(days, 10) || 30)
            : Math.max(1, Number.parseInt(maxAccounts, 10) || 1);
        const cards = cardStore.generateCards(cardType, param, numCount);
        res.json({ ok: true, data: { cards, stats: cardStore.getStats() } });
    });

    // API: 停用/启用卡密（管理员）
    app.post('/api/admin/cards/:code/status', adminRequired, (req: Request, res: Response) => {
        const { status } = req.body || {};
        const nextStatus = String(status || '') === 'disabled' ? 'disabled' : 'active';
        const result = cardStore.setCardStatus(req.params.code, nextStatus as 'active' | 'disabled');
        if (!result.ok) return res.status(404).json({ ok: false, error: result.error });
        res.json({ ok: true });
    });
}

module.exports = { mountAuthRoutes };
