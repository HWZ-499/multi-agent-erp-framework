import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VALID_SLOTS, STUB_SERVICE_MOCKS, validateWidgetOutput } from '../types/contracts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = join(__dirname, '..', 'modules');

/**
 * Boots the Microkernel:
 * 1. Opens SQLite (`:memory:` or file-backed).
 * 2. Executes per-slot `schema.sql` files automatically.
 * 3. Loads `src/modules/<slot>/index.mjs` and optional `widget.mjs`.
 * 4. Exposes `ctx.services.<slot>.<method>` with automatic `[STUB]` mock fallback.
 * 5. Initializes Event Bus (`ctx.bus`) and runs `init(ctx)` on active modules.
 *
 * @param {{ dbPath?: string }} [options]
 */
export async function createKernel({ dbPath = ':memory:' } = {}) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  const listeners = new Map();

  const bus = {
    on(event, handler) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event).push(handler);
      return () => {
        const list = listeners.get(event);
        if (!list) return;
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
    emit(event, payload) {
      const list = listeners.get(event) || [];
      for (const handler of list) {
        handler(payload);
      }
    },
  };

  const modules = new Map();

  for (const slotId of VALID_SLOTS) {
    const slotDir = join(MODULES_DIR, slotId);
    const schemaPath = join(slotDir, 'schema.sql');
    if (existsSync(schemaPath)) {
      const sql = readFileSync(schemaPath, 'utf8');
      if (sql.trim().length > 0) {
        db.exec(sql);
      }
    }

    const indexPath = join(slotDir, 'index.mjs');
    if (!existsSync(indexPath)) {
      throw new Error(`Missing module entry file: ${indexPath}`);
    }

    const mod = await import(pathToFileURL(indexPath).href);
    if (!mod.moduleDef || typeof mod.moduleDef !== 'object') {
      throw new Error(`Module "${slotId}/index.mjs" must export a "moduleDef" object`);
    }

    const descriptor = { ...mod.moduleDef };
    const widgetPath = join(slotDir, 'widget.mjs');
    if (existsSync(widgetPath)) {
      const widgetMod = await import(pathToFileURL(widgetPath).href);
      if (typeof widgetMod.renderWidget !== 'function') {
        throw new Error(`Module widget "${slotId}/widget.mjs" must export a "renderWidget" function`);
      }
      descriptor.renderWidget = widgetMod.renderWidget;
    }

    modules.set(slotId, descriptor);
  }

  const sortedModules = Array.from(modules.values()).sort((a, b) => a.order - b.order);

  const ctx = {
    db,
    bus,
    services: {},
    slotStatus: {},
    serviceCallLog: [],
  };

  for (const slotId of VALID_SLOTS) {
    const modDef = modules.get(slotId);
    ctx.slotStatus[slotId] = modDef.implemented ? 'ACTIVE' : 'STUB';

    const mockMethods = STUB_SERVICE_MOCKS[slotId] || {};
    const activeMethods = modDef.implemented && modDef.services ? modDef.services : {};
    const methodNames = new Set([...Object.keys(mockMethods), ...Object.keys(activeMethods)]);

    const serviceProxy = {};
    for (const methodName of methodNames) {
      serviceProxy[methodName] = async (...args) => {
        const useActive = modDef.implemented === true && typeof activeMethods[methodName] === 'function';
        ctx.serviceCallLog.push({
          slotId,
          method: methodName,
          mode: useActive ? 'ACTIVE' : 'STUB_MOCK',
          at: new Date().toISOString(),
        });
        if (ctx.serviceCallLog.length > 40) {
          ctx.serviceCallLog.shift();
        }

        if (useActive) {
          return await activeMethods[methodName](ctx, ...args);
        }
        return await mockMethods[methodName](ctx, ...args);
      };
    }

    ctx.services[slotId] = serviceProxy;
  }

  for (const modDef of sortedModules) {
    if (modDef.implemented === true && typeof modDef.init === 'function') {
      await modDef.init(ctx);
    }
  }

  return {
    ctx,
    db,
    bus,
    services: ctx.services,
    modules,

    async getDashboard() {
      const slots = [];
      for (const modDef of sortedModules) {
        const slotId = modDef.id;
        if (modDef.implemented === true && typeof modDef.renderWidget === 'function') {
          const rawWidget = await modDef.renderWidget(ctx);
          const validated = validateWidgetOutput(slotId, rawWidget);
          slots.push({ ...validated, status: 'ACTIVE' });
        } else {
          slots.push({
            slotId,
            status: modDef.implemented ? 'ACTIVE' : 'STUB',
            title: `${slotId.toUpperCase()} Module`,
            badge: 'STUB (AUTO-MOCK)',
            summary: `Slot "${slotId}" is currently served by Kernel STUB_SERVICE_MOCKS.${slotId}.`,
            metrics: [
              { label: 'Execution Mode', value: 'STUB MOCK' },
              { label: 'DB Schema', value: 'Awaiting Agent' },
            ],
            html: `<div style="color:#fbbf24;font-size:0.84rem;">Slot <strong>${slotId}</strong> is unimplemented. Calls to <code>ctx.services.${slotId}</code> automatically fall back to frozen contract mocks.</div>`,
          });
        }
      }

      return {
        slots,
        slotStatus: { ...ctx.slotStatus },
        serviceCallLog: ctx.serviceCallLog.slice(-20),
      };
    },

    async handleModuleRoute(slotId, method, action, body = {}, query = {}) {
      const modDef = modules.get(slotId);
      if (!modDef) {
        const err = new Error(`Unknown module slot "${slotId}"`);
        err.statusCode = 404;
        throw err;
      }

      if (modDef.implemented === true && typeof modDef.routes?.[action] === 'function') {
        return await modDef.routes[action](ctx, { method, body, query });
      }

      if (typeof ctx.services[slotId]?.[action] === 'function') {
        if (method === 'GET') {
          const hasQuery = query && Object.keys(query).length > 0;
          return hasQuery
            ? await ctx.services[slotId][action](query)
            : await ctx.services[slotId][action]();
        }
        return await ctx.services[slotId][action](body);
      }

      const err = new Error(`Route "${slotId}/${action}" not found`);
      err.statusCode = 404;
      throw err;
    },

    close() {
      db.close();
    },
  };
}
