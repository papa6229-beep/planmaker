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
- ✅ **Phase 5** — 분리된 정보 영역: 디자인 입력 / 참고자료 / 퍼블리싱 3영역 시각 구분, 규칙 기반 AI 요약 미리보기(퍼블리싱 링크는 AI 요약에 미포함)
- ✅ **Phase 6** — `.eventbrief` 내보내기/불러오기: ZIP 패키징(manifest·brief·preview·assets/references), 내보내기 검증, preview.png(840px) 생성, 트랜잭션 방식 복원(블록·좌표·그룹·이미지 바이트 동일)
- ✅ **Phase 7 (Step 1)** — 제품 셸 도메인 기반: 멀티페이지 문서 스키마(`BriefDocument`)·페이지 순수 함수·v1→v2 마이그레이션·페이지별 참고 이미지 레이어·zoom 뷰 상태 분리, react-router-dom 최소 라우팅 셸(게이트/목록/편집기 진입)
- ✅ **Phase 7 (Step 2)** — 진입 게이트·공통 제품 셸 UI: 앱 헤더/브랜드, 업무 선택 게이트(기획서 생성·이미지 생성 2카드), `/briefs`·`/image-requests` 정직한 빈 상태(가짜 목록·가짜 건수 없음), 향후 요청 KPI 주입용 구조만 준비
- ✅ **Phase 7 (Step 3)** — 기획서 화면 상단 재구성: 게이트로 돌아가기 · `기획서 생성` 모드 표시 · 기획서 제목 입력란(단일 원본) · 파일 저장/불러오기 보조 메뉴 · `전달하기` Primary CTA(동작은 Step 7)
- ✅ **Phase 7 (Step 4)** — 멀티페이지: 캔버스 위 페이지 필름스트립(추가/복제/삭제/순서 변경/이름 변경), 페이지별 독립 blocks·그룹·캔버스 높이·참고 레이어, `.eventbrief` **v2 멀티페이지 저장·불러오기 round-trip**(페이지별 preview), v1 파일은 1페이지로 자동 마이그레이션
- 🚧 **Phase 7 (Step 5)** — 참고 이미지 UI: `도움 도구` 참고 이미지 추가/교체/제거(출력 블록 아님), 보기 모드 캔버스만·나란히 보기(독립 스크롤·줌·원본 비율 맞춤)·오버레이(표시 on/off·투명도 0~100% 기본 35%·위치 맞춤). 참고 이미지는 AI 입력·preview 출력에서 제외
- ⛔ Phase 7 나머지 Step(요청 저장소·전달 동작·인라인 편집) 및 AI 연결은 아직 구현하지 않음

### 멀티페이지 도메인 (Phase 7 Step 1)

- `BriefDocument`(v2.0.0) = `project` + `pages[]` + `activePageId` + 공유 `assets[]`
- 각 페이지: 고정 **840px** 캔버스 + 블록 + 페이지 단위 **참고 이미지 레이어**(오버레이 투명도 기본 35%)
- 기존 단일 페이지 `EventBrief`(v1)·`.eventbrief` v1 파일은 `migrateToDocument`로 `pages[0]`에 무손실 마이그레이션
- 페이지 추가/복제(ID 재생성)/삭제/순서변경 순수 함수, 마지막 페이지 삭제 불가·활성 페이지 불변식 유지
- **zoom은 저장하지 않는 뷰 상태**(`canvasView.ts`) — `BriefDocument`/`.eventbrief`에 미포함
- 라우트: `/` · `/briefs` · `/briefs/new` · `/briefs/:id`(편집기) · `/image-requests` · `/image-requests/:id`

### 진입 게이트 · 제품 셸 UI (Phase 7 Step 2)

- 공통 셸 컴포넌트(`src/components/shell/`): `AppShellLayout` · `AppHeader` · `AppBrand` · `PageHeader` · `EmptyState` · `StatusBadge`
- `/` 게이트: 앱 헤더 + "어떤 작업을 시작할까요?" 인트로 + 진입 카드 2개(**기획서 생성** → `/briefs` 파랑, **이미지 생성** → `/image-requests` 보라). 카드 전체가 키보드 포커스 가능한 단일 링크
- **가짜 데이터 없음**: 요청 건수·상태를 지어내지 않음. 이미지 카드는 "요청 관리 연결 예정" 중립 안내만 표시하고, 향후 `RequestRepository` KPI(신규/작업 중/완료/전체)를 주입할 슬롯(`EntryCard.stats`)만 준비
- `/briefs`·`/image-requests`: 정직한 빈 상태. `/image-requests`의 신규/작업 중/완료 배지는 실제 값 0(지어낸 숫자 아님)
- 편집기(`/briefs/new`·`/briefs/:id`)는 기존 `AppShell`을 **수정 없이** 마운트
- 디자인 토큰은 `.shell` 클래스에 스코프 → 편집기 스타일과 분리. 색은 역할 구분에만 사용, 그라디언트/글로우 없음, `prefers-reduced-motion` 대응

### 멀티페이지 편집 · v2 파일 (Phase 7 Step 4)

- 캔버스 위 **페이지 필름스트립**(`PageTabs`): 페이지 추가 · 복제 · 삭제(마지막 1장 보호) · 왼쪽/오른쪽 이동 · 이름 변경(더블클릭 또는 메뉴)
- 블록 편집기는 단일 페이지 그대로 유지 — `BriefDocumentProvider`가 **활성 페이지를 `EventBrief`로 투영**해 편집시키고, 편집 결과를 문서에 되돌려 동기화(페이지 전환 시에만 재하이드레이트하여 페이지별 Undo 유지)
- 페이지별 독립 상태: blocks·블록 순서·그룹·캔버스 높이·참고 레이어 데이터(참고 이미지 **UI**는 Step 5)
- **자동저장이 문서(v2) 단위로 전환** — 새로고침 후 모든 페이지·블록 복원. 기존 v1 자동저장 스냅샷은 불러올 때 자동 마이그레이션
- `.eventbrief` **v2**: `document.json`(모든 페이지) + `previews/page-01.png…`(페이지별) + 공유 `assets/`·`references/`. 내보낸 뒤 다시 불러오면 페이지 순서·이름·activePageId·블록·그룹·캔버스 높이·참고 레이어가 동일하게 복원
- 기존 **v1 `.eventbrief`(단일 페이지)** 파일은 1페이지 문서로 자동 마이그레이션되어 그대로 열림

### 참고 이미지 (Phase 7 Step 5)

- 좌측 `도움 도구` 패널(`ReferenceTools`): **참고 이미지 추가/교체/제거** — 콘텐츠 블록 팔레트와 분리. 참고 이미지는 페이지 단위 보조 자산이며 **출력 블록이 아님**(캔버스에 블록을 만들지 않음)
- 중앙 상단 보기 모드(`ReferenceViewControls`): **캔버스만 / 나란히 보기 / 오버레이**
- **나란히 보기**(`ReferenceSideView`): 캔버스 옆 참고 이미지 뷰어 — 독립 스크롤 · 확대/축소 · `원본 비율 맞춤`. 줌은 저장하지 않는 뷰 상태
- **오버레이**: 참고 이미지를 840px 캔버스 좌표계 배경에 표시(블록은 그 위에서 편집) · 표시 on/off · 투명도 슬라이더 0~100%(기본 35%) · 위치 맞춤(폭 맞춤/원본 크기/중앙 맞춤)
- **출력 제외**(§8.4): 참고 이미지는 AI 디자인 입력·`designSummary`·페이지별 preview에 포함되지 않음. 보기 모드/투명도/위치 맞춤은 페이지별 상태로 `.eventbrief`에 저장되어 왕복
- 저장 경로: 참고 이미지 바이너리는 공유 자산 풀(IndexedDB + `.eventbrief` `references/`)에 저장, 페이지 `reference.assetId`로 연결

### 기획서 화면 상단 재구성 (Phase 7 Step 3)

- 편집기 상단바(`TopToolbar`) 재설계 — 왼쪽: **게이트로 돌아가기** 링크 · `기획서 생성` 모드 배지 · **기획서 제목 입력란**
- 제목 입력란은 프로젝트 이름의 **단일 원본**(`SET_PROJECT_TITLE`, 타이핑은 한 단계 Undo로 병합). 비우면 `기획서 제목을 입력하세요` placeholder 노출
- 오른쪽: 자동 저장 상태 · 실행 취소 · 다시 실행 · AI 요약 · **보조 메뉴**(파일로 저장 `.eventbrief` / 파일 불러오기 / 새로 만들기) · Primary CTA **전달하기**
- **전달하기는 이번 단계에서 동작하지 않음** — 클릭 시 "요청 전달 기능은 다음 단계에서 연결됩니다" 안내만 표시하고 요청을 만들지 않음. `WorkRequest`·`RequestRepository`·요청 목록/상태는 Step 7에서 구현
- 기존 `.eventbrief` 저장/불러오기 기능은 삭제하지 않고 보조 메뉴로 이동(전부 그대로 동작)

### 내보내기 / 불러오기 (Phase 6)

- 상단 보조 메뉴 **파일로 저장(.eventbrief)** → 검증(오류 차단 / 경고 확인) → `preview.png` 생성 → `{프로젝트명}.eventbrief`(ZIP) 다운로드
- 상단 보조 메뉴 **파일 불러오기** 또는 `.eventbrief` 파일을 화면에 드래그앤드롭
- 불러오기는 전체 아카이브를 메모리에서 검증한 뒤에만 한 번에 교체(부분 복원·기존 프로젝트 손상 없음)
- `.eventbrief` 내부 구조: `manifest.json` · `brief.json`(단일 원본) · `preview.png` · `assets/`(디자인 이미지) · `references/`(참고·퍼블리싱 이미지)
- 이미지 ZIP 경로는 `{assetId}__{원본파일명}` 규칙으로 충돌 없이 생성, 원본 파일명/MIME/투명 PNG·GIF 바이너리 보존

### 정보 영역 분리 (Phase 5)

- 블록의 **AI 전달 여부**(디자인 입력 / 참고 / 퍼블리싱)에 따라 카드 색상을 3가지로 구분
- 상단 **AI 요약** 버튼 → 규칙 기반 요약 미리보기(§15)
  - 디자인 입력: 이미지 생성 AI가 읽는 정보(메인 문구·제품·혜택·버튼·배치 우선순위 등)
  - 참고자료: AI가 참고할 수 있는 정보
  - 퍼블리싱 정보: **AI에 전달되지 않는** 링크·메모 (CTA 버튼은 URL 대신 연결 여부만 표시)

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
