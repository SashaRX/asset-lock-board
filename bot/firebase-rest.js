// Minimal Firebase Realtime Database REST client (no SDK, no dependencies)
const https = require('https');
const { URL } = require('url');

class FirebaseRest {
  constructor(dbUrl) {
    this.dbUrl = dbUrl.replace(/\/$/, '');
  }

  async get(path) {
    const res = await this._request('GET', path);
    return JSON.parse(res);
  }

  async set(path, data) {
    await this._request('PUT', path, JSON.stringify(data));
  }

  async update(path, data) {
    await this._request('PATCH', path, JSON.stringify(data));
  }

  async remove(path) {
    await this._request('DELETE', path);
  }

  // Server-Sent Events listener (replaces onValue)
  listen(path, callback) {
    const url = new URL(`${this.dbUrl}/${path}.json`);
    url.searchParams.set('auth', '');
    const opts = {
      hostname: url.hostname,
      path: `${url.pathname}?${url.searchParams}`,
      headers: { 'Accept': 'text/event-stream' },
    };

    let current = null;
    const connect = () => {
      const req = https.get(opts, (res) => {
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop(); // incomplete line
          let eventType = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventType = line.slice(6).trim();
            if (line.startsWith('data:') && eventType === 'put') {
              try {
                const payload = JSON.parse(line.slice(5).trim());
                if (payload.path === '/') {
                  current = payload.data;
                } else {
                  if (!current) current = {};
                  const parts = payload.path.split('/').filter(Boolean);
                  let obj = current;
                  for (let i = 0; i < parts.length - 1; i++) {
                    if (!obj[parts[i]]) obj[parts[i]] = {};
                    obj = obj[parts[i]];
                  }
                  const last = parts[parts.length - 1];
                  if (payload.data === null) delete obj[last];
                  else obj[last] = payload.data;
                }
                callback(current);
              } catch {}
              eventType = '';
            }
            if (line.startsWith('data:') && eventType === 'patch') {
              try {
                const payload = JSON.parse(line.slice(5).trim());
                if (!current) current = {};
                const base = payload.path === '/' ? current : (() => {
                  const parts = payload.path.split('/').filter(Boolean);
                  let obj = current;
                  for (const p of parts) { if (!obj[p]) obj[p] = {}; obj = obj[p]; }
                  return obj;
                })();
                if (payload.data && typeof payload.data === 'object') {
                  for (const [k, v] of Object.entries(payload.data)) {
                    if (v === null) delete base[k]; else base[k] = v;
                  }
                }
                callback(current);
              } catch {}
              eventType = '';
            }
          }
        });
        res.on('end', () => { setTimeout(connect, 2000); });
        res.on('error', () => { setTimeout(connect, 5000); });
      });
      req.on('error', () => { setTimeout(connect, 5000); });
    };
    connect();
  }

  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.dbUrl}/${path}.json`);
      const opts = {
        hostname: url.hostname,
        path: url.pathname,
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
      const req = https.request(opts, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

module.exports = FirebaseRest;
