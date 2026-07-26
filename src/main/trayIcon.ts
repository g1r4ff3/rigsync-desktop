/**
 * 트레이 아이콘 — rigsync 브랜드 글리프(reference 노드=채워진 원 + follower
 * 노드=링, `build/icon-tray.svg`가 소스). 16px는 Windows/Linux 트레이, 22px는
 * 더 고해상도 트레이(예: macOS @1x가 아닌 환경)용 — Electron `nativeImage`가
 * 필요에 따라 스케일한다.
 *
 * 값은 `scripts/generate-icons.mjs`가 `build/icon-tray.svg`를 래스터화해 이
 * 파일의 두 상수를 갱신한 결과다(이 두 export 선언 형태는 유지한 채 값만
 * 교체 — 디자인을 바꾸려면 icon-tray.svg를 고치고 스크립트를 다시 돌린다).
 * 앱 아이콘(`build/icon.svg`)에는 방향을 나타내는 쉐브론이 더 있지만, 16/22px
 * 트레이 크기에서는 뭉개져 두 원만 남긴 단순화 버전을 쓴다.
 */
export const TRAY_ICON_PNG_BASE64_16 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAADsOAAA7DgHMtqGDAAABCElEQVQ4jdVSTUpDQQx+1IW9hGvP8JKKfxsvIOq2C9suvIHwmswJ7KIIgnuL4MGqpRaTEUVHMvLgTaFjEVwYCENm8n1JvkxR/AvbrUK7JH9Ysp6Wzh9YvDa4M9QzJH1E1lA7kM7AyUWSuON0C1nvkWRhDqQPSDpqApcdWKsm+Gl1snwg6U2H5RxIr4HlPd6TvEWCWDlTCZ30mt0CSb9+KyKBtb2a4LOoQiuZtwotJJ3/muB4EjYSAjDBciOw7yYjOBkkIwC/bttqsiKy3JqIdn7HDRHrTQDrBFmezYHkDullnO2M9DKCc2a/D1inS/ufwlBPfgTXZl8XyO8bGTq/d3QVNtcG/7l9Ac/YQjgkZrQ3AAAAAElFTkSuQmCC'

export const TRAY_ICON_PNG_BASE64_22 =
  'iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAACXBIWXMAADsOAAA7DgHMtqGDAAABh0lEQVQ4je2UzytEURTHnyhjR/JXSGyUOWfqWWEhorAgK3ZEsZJ675wJKwux9Xsz8c9ospGViKL8mnfOpHA1MzXNm+flTpZ86+7O+XTP93zvdZx//UY9m6YJ0/leYJ1CltEeznX8Cphae20D1m0gCZDVhI9cIuu0Y0xd7G2AZQhJl5FkMUWKhWLwgi5kvY4CwwdYT1zPJEJQJBkB0ttIMUkWWB9+glbUH5ah4OsEknxaNr4jSwZJ5oB0BUmz1TUl7zaeW4D00e5G8gbpfF/lpGMnph5Z9iJg8INZ2zFTpLuxu6mwsQQm3bH2z1cvLjXAchQGs25bgzkejCTHVeBgxhaMJHvxMdW7ENj1npprWV6Sgv5KqOuZBmA5iCyvOAbruG3ckOUDSU8hLfNIugqk59/GrWw+yTCS3nyT2zMgva/Brv2IV65nEikOBpF1CVkWgDRZeNLIQSewXFlMkxnYMo1OLepef2lF1i1gyUXTIhfg62TsJ2Sj4lSkbvHbJBlBzrVbNTp/Ul8iwF4lDXrmUQAAAABJRU5ErkJggg=='

export function trayIconDataUrl(size: 16 | 22 = 22): string {
  const b64 = size === 16 ? TRAY_ICON_PNG_BASE64_16 : TRAY_ICON_PNG_BASE64_22
  return `data:image/png;base64,${b64}`
}
