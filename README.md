# Event Brief Builder

비디자이너가 블록을 쌓듯 문구·이미지·혜택·버튼을 배치하고 의미를 지정하면,
이미지 생성 AI가 바로 읽을 수 있는 구조화 기획서(`.eventbrief`)를 만드는 도구입니다.

> 단일 기준 문서: `EVENT_BRIEF_BUILDER_WORK_PLAN.md`
> 이 도구는 디자인 툴이 아니라 **기획 의도 배치판**입니다. 최종 디자인은 별도 이미지 생성기가 담당합니다.

## 현재 진행 상황

- ✅ **Phase 0** — Vite + React + TypeScript(strict) 프로젝트 구성, lint/typecheck/test/build 스크립트, 3열 UI 셸
- ✅ **Phase 1** — 도메인 스키마(Project / BriefBlock / Asset / PublishingInfo), 블록 타입 카탈로그, 검증 규칙, AI용 designSummary 생성기, 샘플 fixture, Vitest 단위 테스트
- ✅ **Phase 2** — 기본 UI(팔레트·캔버스·속성 패널), 블록 생성/선택/삭제, 편집, 키보드 삭제 보호
- ✅ **Phase 3** — 캔버스 편집: 드래그 이동(그룹 단위), 코너 리사이즈, 복제, 다중 선택·그룹화/해제, Undo/Redo(제스처 병합)
- ✅ **Phase 4** — 이미지 자산: 파일 업로드·다중 업로드·드래그앤드롭·Ctrl+V 붙여넣기, 원본 파일명/투명 배경 보존, IndexedDB(Dexie) 자동저장 및 새로고침 복구
- ⛔ Phase 5 이후(정보 영역 분리 강화, 내보내기, AI 연결 등)는 아직 구현하지 않음

### 이미지 입력 (Phase 4)

- 속성 패널에서 이미지 블록 선택 → 업로드/교체/제거
- 이미지를 캔버스로 드래그앤드롭 → 위치에 새 이미지 블록 생성
- Ctrl+V → 선택된 이미지 블록에 붙여넣기(없으면 새 블록 생성)
- 이미지 바이너리는 IndexedDB에 저장되어 브라우저 새로고침 후 복구됨

### 캔버스 편집 단축키 (Phase 3)

- 드래그: 블록을 끌어 이동 (그룹은 함께 이동)
- 코너 핸들: 크기 조절
- Shift+클릭: 다중 선택 → 그룹으로 묶기
- Ctrl/Cmd+D: 복제 · Delete/Backspace: 선택 삭제(입력 중 보호)
- Ctrl/Cmd+Z: 실행 취소 · Ctrl/Cmd+Shift+Z (또는 Ctrl+Y): 다시 실행

## 스크립트

```bash
npm install
npm run dev        # 개발 서버
npm run lint       # oxlint
npm run typecheck  # tsc -b --noEmit (strict)
npm run test       # vitest 단위 테스트
npm run build      # 타입체크 + 프로덕션 번들
```

## 도메인 계층 (`src/domain/`)

`.eventbrief` 파일의 `brief.json`이 유일한 원본 데이터입니다. 도메인 계층은 UI와 분리되어
있어 추후 GODO AI OS로 이식하기 쉽습니다.

| 파일 | 역할 |
| --- | --- |
| `blockTypes.ts` | 의미 중심 블록 타입 카탈로그 (색상·도형 추론 없음) |
| `briefSchema.ts` | Project / BriefBlock / Asset / DesignSummary / PublishingInfo 타입 |
| `factory.ts` | 기본값이 채워진 블록·기획서 생성 헬퍼 |
| `validation.ts` | 내보내기 전 오류/경고 검증 (WORK_PLAN §14) |
| `summaryBuilder.ts` | 규칙 기반 AI용 요약 + 퍼블리싱 정보 분리 (WORK_PLAN §15) |

### 핵심 설계 규칙

- **의미 중심**: 블록은 최종 컴포넌트가 아니라 의미 역할입니다.
- **위치는 소프트 힌트**: 좌표는 840px 기준으로 저장하되 AI에는 참고값으로만 전달합니다.
- **정보 분리**: 디자인 정보 / 참고 정보 / 퍼블리싱 정보를 명확히 구분하며,
  AI용 `designSummary`에는 퍼블리싱 링크(URL)가 절대 포함되지 않습니다.

## 폴더 구조

```text
src/
├─ app/         애플리케이션 셸 (App.tsx)
├─ domain/      도메인 로직 (UI 비의존)
├─ fixtures/    샘플 기획서
└─ styles/      전역 CSS
```

컴포넌트/스토어/서비스(`components/`, `stores/`, `services/`, `features/`)는
해당 Phase에서 추가합니다.
