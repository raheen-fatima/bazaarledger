import { DEFAULT_CURRENCY, formatMoney, toMajorUnits, toMinorUnits } from '../../shared/money.ts';
import type { AppSettings } from '../../shared/types.ts';

export function formatCurrency(minorAmount: number, settings?: AppSettings): string {
  const currency = settings
    ? {
        code: settings.currency_code,
        symbol: settings.currency_symbol,
        minorUnitsPerMajor: 100,
      }
    : DEFAULT_CURRENCY;
  return formatMoney(minorAmount, currency);
}

export function formatDateTime(iso: string): string {
  if (!iso) return '-';
  // SQLite datetime('now') is UTC 'YYYY-MM-DD HH:MM:SS'
  const normalized = iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>): void {
  const escape = (cell: string | number): string => {
    const s = String(cell ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export { toMajorUnits, toMinorUnits };
