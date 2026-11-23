/**
 * SLOT 4: Audit Event Ledger Module (Assigned to Agent-Audit)
 */

const SUBSCRIBED_EVENTS = [
  'inventory.reserved',
  'inventory.released',
  'inventory.restocked',
  'order.created',
  'invoice.created',
];

function parsePayloadJson(rawJson) {
  try {
    return JSON.parse(rawJson);
  } catch {
    return { _raw: rawJson };
  }
}

function persistAuditLog(ctx, input = {}) {
  const { eventName, payload } = input && typeof input === 'object' ? input : {};
  if (typeof eventName !== 'string' || eventName.trim().length === 0) {
    throw new Error('Audit eventName must be a non-empty string');
  }

  const cleanEventName = eventName.trim();
  const normalizedPayload = payload ?? {};
  const payloadJson = JSON.stringify(normalizedPayload) ?? '{}';
  const createdAt = new Date().toISOString();

  const res = ctx.db
    .prepare('INSERT INTO audit_logs (event_name, payload_json, created_at) VALUES (?, ?, ?)')
    .run(cleanEventName, payloadJson, createdAt);

  return {
    id: Number(res.lastInsertRowid),
    eventName: cleanEventName,
    payload: normalizedPayload,
    createdAt,
  };
}

export const moduleDef = {
  id: 'audit',
  order: 40,
  implemented: true,

  init(ctx) {
    for (const eventName of SUBSCRIBED_EVENTS) {
      ctx.bus.on(eventName, (payload) => {
        persistAuditLog(ctx, { eventName, payload });
      });
    }
  },

  services: {
    record(ctx, input) {
      return persistAuditLog(ctx, input);
    },

    listLogs(ctx, options = {}) {
      const rawLimit =
        options && typeof options === 'object' && options.limit !== undefined ? options.limit : 20;
      const limit = Number(rawLimit);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error('Audit listLogs limit must be a positive integer');
      }

      const rows = ctx.db
        .prepare('SELECT id, event_name, payload_json, created_at FROM audit_logs ORDER BY id DESC LIMIT ?')
        .all(limit);

      return rows.map((row) => ({
        id: Number(row.id),
        eventName: row.event_name,
        payload: parsePayloadJson(row.payload_json),
        createdAt: row.created_at,
      }));
    },
  },

  routes: {},
};
