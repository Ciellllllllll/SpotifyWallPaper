import { isIP } from 'node:net';
import { decodeBase64Url } from './crypto.js';

export type CookieValue =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'valid'; value: string };

export function canonicalIssuer(value: string): string | null {
  if (value.includes(',') || value !== value.trim()) return null;
  if (isIP(value) === 4) {
    const bytes = parseIpv4(value);
    return bytes === null
      ? null
      : `v4:${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  if (isIP(value) !== 6) return null;

  const words = expandIpv6(value);
  if (words === null) return null;
  if (
    words.slice(0, 5).every((word) => word === 0) &&
    words[5] === 0xffff
  ) {
    return `v4:${words
      .slice(6)
      .flatMap((word) => [word >> 8, word & 0xff])
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
  }
  return `v6:${words.map((word) => word.toString(16).padStart(4, '0')).join('')}`;
}

export function readSingleCookie(
  header: string | null,
  name: string
): CookieValue {
  if (header === null) return { kind: 'missing' };
  const values = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  if (values.length === 0) return { kind: 'missing' };
  if (values.length !== 1) {
    return { kind: 'invalid' };
  }
  const value = values[0] ?? '';
  try {
    decodeBase64Url(value, 32);
  } catch {
    return { kind: 'invalid' };
  }
  return { kind: 'valid', value };
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split('.');
  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !/^(0|[1-9]\d{0,2})$/u.test(part) || Number(part) > 255
    )
  ) {
    return null;
  }
  return parts.map(Number);
}

function expandIpv6(value: string): number[] | null {
  let normalized = value.toLowerCase();
  const ipv4Match = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized);
  if (ipv4Match !== null) {
    const bytes = parseIpv4(ipv4Match[2]);
    if (bytes === null) return null;
    normalized = `${ipv4Match[1]}${((bytes[0] << 8) | bytes[1]).toString(16)}:${(
      (bytes[2] << 8) |
      bytes[3]
    ).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 1 || halves[1] === '' ? [] : halves[1].split(':');
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return null;
  }
  const parts = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) {
    return null;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}
