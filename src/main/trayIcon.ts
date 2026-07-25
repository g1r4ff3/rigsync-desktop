/**
 * 트레이 아이콘 placeholder — 단색 원형 PNG를 코드로 직접 생성해 base64로
 * 박아 넣었다(외부 에셋 파일 불필요, 디자인 투자 금지 지시 준수). 16px는
 * Windows/Linux 트레이, 22px는 더 고해상도 트레이(예: macOS @1x가 아닌
 * 환경)용 — Electron `nativeImage`가 필요에 따라 스케일한다.
 *
 * ⚠ 디자인 패스(제품 방향에서 예고된 후속 작업)에서 실제 브랜드 아이콘으로
 * 교체될 자리표시자다. 생성 스크립트는 커밋에 없다(1회성 유틸 — 필요하면
 * 동일 방식으로 재생성: 순수 Node zlib로 RGBA raw scanline을 deflate해 PNG
 * IHDR/IDAT/IEND 청크를 직접 조립).
 */
export const TRAY_ICON_PNG_BASE64_16 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaUlEQVR4nGNgQAM9PdMse3qmzejpmXazp2fabyi+CRWzRFePrhmk6D8BPAOX5h1EaIbhHeTYjN0lUD+TqhmGLcm1HeEKaAiTa8BNBmg0kWvAb6oYQLEXKA5EyqKR4oRElaRMlcxEbnYGADc3MwvElpBhAAAAAElFTkSuQmCC'

export const TRAY_ICON_PNG_BASE64_22 =
  'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAAoklEQVR4nLWV0Q2AIAxEu4NbOJxb8HffncQxHIMxSDSYYgyCEuFI7gfoC2mPVqSyAJ0AXQBdAfWABpO3vXg21eJrUGeQ/UPxjmsBzoBuDcBcMWZ+g/of0CRfhP986ePlpZz2QpPcvfothWpVON1ithkFTVrEPDkavEqnE6oOkcH5vfJMBdNSQSsezW6cD0L70tQmRG2btEZfaKPjRlMG7xqmB87gKDHPTppsAAAAAElFTkSuQmCC'

export function trayIconDataUrl(size: 16 | 22 = 22): string {
  const b64 = size === 16 ? TRAY_ICON_PNG_BASE64_16 : TRAY_ICON_PNG_BASE64_22
  return `data:image/png;base64,${b64}`
}
