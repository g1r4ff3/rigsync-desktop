import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * 검수 R4-2 #1: 헤더의 manifestDir가 폭 대부분을 차지해 machineId·role·sync
 * 상태가 묻히는 문제 — "밀도는 여백 절약이 아니라 중요도 순 배치"라 경로는
 * 좌측(앞부분)을 생략하고 꼬리만 보여준다("…/rigsync-desktop/manifest").
 *
 * font-mono(고정폭) 전제 — 렌더 폭을 픽셀로 재지 않아도 문자 수 = ch 단위
 * 폭이 1:1이라 CSS `overflow`/bidi 트릭 없이 문자열 자르기만으로 정확히
 * 예측 가능한 폭을 만든다. 전문은 별도로 Tooltip에 넘겨 보여준다.
 */
export function truncatePathStart(path: string, maxChars: number): string {
  if (path.length <= maxChars) return path
  return `…${path.slice(path.length - (maxChars - 1))}`
}
