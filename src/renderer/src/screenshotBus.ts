/**
 * R4 스크린샷 하네스 전용 — App.tsx가 main의 `engine:screenshotGoto` push를
 * 받아 하위 컴포넌트(예: DiffView 안의 Apply 다이얼로그)에 다시 뿌리는 데
 * 쓰는 window CustomEvent 이름. 별도 파일로 뺀 이유는 App.tsx <-> DiffView.tsx
 * 순환 import를 피하기 위해서다(둘 다 이 상수 하나만 가져온다).
 */
export const SCREENSHOT_GOTO_EVENT = 'rigsync:screenshot-goto'
