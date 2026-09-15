// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FloodOS Contributors

export function toDateTimeLocal(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function fromDateTimeLocal(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export function defaultHarvestWindow(): { start: string; end: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(7, 0, 0, 0);
  const end = new Date(start);
  end.setHours(11, 0, 0, 0);
  return { start: toDateTimeLocal(start.toISOString()), end: toDateTimeLocal(end.toISOString()) };
}

export function formatLocalDateTime(value: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' }): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('vi-VN', options) : 'Chưa xác định';
}

export function formatLocalTime(value: string): string {
  return formatLocalDateTime(value, { hour: '2-digit', minute: '2-digit' });
}
