export class ErroreApi extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(metodo, url, corpo) {
  let res;
  try {
    res = await fetch(url, {
      method: metodo, credentials: 'same-origin',
      headers: corpo && !(corpo instanceof FormData) ? { 'content-type': 'application/json' } : {},
      body: corpo instanceof FormData ? corpo : corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch { throw new ErroreApi(0, 'Nessuna connessione'); }
  const dati = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/login') && !url.endsWith('/me')) window.dispatchEvent(new Event('sessione-scaduta'));
    throw new ErroreApi(res.status, dati?.errore || 'Errore ' + res.status);
  }
  return dati;
}
export const get = (u) => api('GET', u);
export const post = (u, b) => api('POST', u, b);
export const put = (u, b) => api('PUT', u, b);
export const del = (u) => api('DELETE', u);
