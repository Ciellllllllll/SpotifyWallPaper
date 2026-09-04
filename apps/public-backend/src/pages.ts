import { readFileSync } from 'node:fs';

const privacyDocument = readFileSync(
  new URL('../legal/privacy.md', import.meta.url),
  'utf8'
).trim();
const eulaDocument = readFileSync(
  new URL('../legal/eula.md', import.meta.url),
  'utf8'
).trim();

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

export function healthPage(): Response {
  return Response.json(
    {
      ok: true,
      value: { service: 'spotify-wallpaper-backend' }
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export function privacyPage(): Response {
  return legalPage('Privacy Notice', privacyDocument);
}

export function termsPage(): Response {
  return legalPage('End User License Agreement', eulaDocument);
}

function legalPage(title: string, document: string): Response {
  return htmlPage(
    200,
    title,
    `<h1>${escapeHtml(title)}</h1><pre>${escapeHtml(document)}</pre>`
  );
}

function htmlPage(
  status: number,
  title: string,
  content: string
): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main>${content}</main></body></html>`,
    {
      status,
      headers: {
        ...securityHeaders,
        'Content-Type': 'text/html; charset=utf-8'
      }
    }
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
