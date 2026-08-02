// 与后端通信：REST + WebSocket 封装。
const API = '/api';

async function j(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.json();
}

export const api = {
  getConfig: () => j('GET', '/config'),
  getProviderTemplates: () => j('GET', '/provider-templates'),
  upsertProvider: (id, data) => j('PUT', `/providers/${id}`, data),
  removeProvider: (id) => j('DELETE', `/providers/${id}`),
  discoverModels: (id) => j('GET', `/providers/${id}/models`),
  testModel: (id, model) => j('POST', `/providers/${id}/test`, { model }),
  werewolfPresets: () => j('GET', '/games/werewolf/presets'),
  upsertAgent: (agent) => j('POST', '/agents', agent),
  removeAgent: (id) => j('DELETE', `/agents/${id}`),
  setWorkspace: (workspace) => j('PUT', '/workspace', { workspace }),
  listSessions: () => j('GET', '/sessions'),
  getSession: (id) => j('GET', `/sessions/${id}`),
  createSession: (title, participants, maxTurnsPerRequest, workspace) => j('POST', '/sessions', { title, participants, maxTurnsPerRequest, workspace }),
  setParticipants: (id, participants, maxTurnsPerRequest, workspace) => j('PUT', `/sessions/${id}/participants`, { participants, maxTurnsPerRequest, workspace }),
  pinSession: (id, pinned) => j('PUT', `/sessions/${id}/pin`, { pinned }),
  deleteSession: (id) => j('DELETE', `/sessions/${id}`),
};

// WebSocket 连接管理，带断线重连和事件订阅。
export function connectWS(onEvent) {
  let ws;
  let closed = false;
  const queue = [];

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      while (queue.length) ws.send(queue.shift());
      onEvent({ type: '_open' });
    };
    ws.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => {
      onEvent({ type: '_close' });
      if (!closed) setTimeout(open, 1000);
    };
  }
  open();

  return {
    send(obj) {
      const data = JSON.stringify(obj);
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
      else queue.push(data);
    },
    close() { closed = true; ws?.close(); },
  };
}
