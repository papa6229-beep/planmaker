# PLANMAKER self-host (회사 4090 서버에서 실행)

Vercel 없이 회사 서버에서 PLANMAKER를 돌린다. Node 프로세스 하나가 두 가지를 맡는다.

- **화면:** Studio. 팀원은 `http://<서버 IP>:3000/studio`로 접속한다.
- **서버 기능:** `/api/access-mode`, `/api/generate-image`, `/api/refine-instruction`.

이미지 생성 요청은 인터넷을 거치지 않는다. 같은 서버의 로컬 어댑터(`127.0.0.1:8787`)로 바로 간다.

서버 기능 코드(`api/`, `src/`)는 **Vercel과 같은 것을 그대로** 쓴다. 이 폴더는 그것을 Vercel 대신 부르는 실행기일 뿐이다.

## 파일

| 파일 | 역할 |
|---|---|
| `server.mjs` | 서버 실행 파일. 화면(`dist/`)과 API(`dist-ssr/api/`)를 제공 |
| `build-api.mjs` | `api/*.ts`를 Vercel과 같은 방식으로 컴파일해 `dist-ssr/`에 둠 |
| `planmaker.env.example` | 설정 예시. 저장소 밖에 복사해서 값을 채움 |
| `planmaker.service.example` | systemd 서비스 예시(재부팅 후 자동 실행) |
| `nginx.conf.example` | (선택) 앞에 nginx를 둘 때의 설정 예시 |

## 준비물

- Node.js 22 이상. Windows에서 24.13.0으로 확인했다.
- 이 저장소의 `local-qwen-main` 브랜치(로컬 AI 연결 코드가 들어 있음)
- 같은 서버에서 동작 중인 어댑터(`127.0.0.1:8787`)

## 1. 빌드

```bash
git clone <저장소 주소> /opt/planmaker
cd /opt/planmaker
git checkout local-qwen-main
npm ci
VITE_PLANMAKER_SURFACE=studio npm run build   # 화면 → dist/
node selfhost/build-api.mjs                   # API → dist-ssr/api/
```

`build-api.mjs`가 TypeScript 진단을 몇 건 출력할 수 있다. Vercel 빌드와 같이 emit은 계속되고, 마지막 줄에 함수 3개가 나오면 정상이다.

## 2. 설정

```bash
sudo mkdir -p /etc/planmaker
sudo cp selfhost/planmaker.env.example /etc/planmaker/planmaker.env
sudo chmod 600 /etc/planmaker/planmaker.env
```

값을 채울 항목은 다음과 같다.

- `OPENAI_API_KEY`: 지시 다듬기에 계속 필요하다.
- `PLANMAKER_ACCESS_CODE`: 팀원이 입력할 접속 암구호.
- `LOCAL_IMAGE_API_URL`: 어댑터 생성 주소. 지금 Windows PC `.env`의 값과 같은 경로를 쓴다.
- `LOCAL_IMAGE_API_KEY`: 어댑터 Bearer 키.

## 3. 실행

**직접 실행해서 확인할 때**

```bash
node --env-file=/etc/planmaker/planmaker.env selfhost/server.mjs
```

시작 로그에서 확인할 것:
- `[selfhost] API:` 줄에 함수 3개가 나온다.
- `[selfhost] env:` 줄에 필요한 항목이 모두 `set`이다. 값은 찍히지 않는다.

**서비스로 등록할 때** (`planmaker.service.example`의 사용자·경로를 맞춘 뒤)

```bash
sudo cp selfhost/planmaker.service.example /etc/systemd/system/planmaker.service
sudo systemctl daemon-reload
sudo systemctl enable --now planmaker
journalctl -u planmaker -f
```

**동작 확인**

```bash
curl http://127.0.0.1:3000/api/access-mode   # {"mode":"server-key"} 이어야 한다
```

마지막으로 브라우저에서 `http://<서버 IP>:3000/studio`를 열어 생성 1회를 확인한다.

## 시간 제한 정책

이미지 한 장이 몇 분씩 걸린다. 중간 어디서든 끊기면, 서버는 그림을 만들고 화면에는 실패만 남는다.

| 자리 | 설정 |
|---|---|
| 브라우저 → 서버 | 제한 없음 |
| Node 서버(요청 수신) | `requestTimeout = 0`으로 끔 (Node 기본값은 300초) |
| 서버 → 어댑터 | Node 내장 `fetch`의 응답 헤더 대기 300초 제한을 쓰지 않음. `http:` 주소는 제한 없는 `node:http`로 보낸다. `https:`(OpenAI)는 기존 그대로 |
| PLANMAKER 자체 상한 | `LOCAL_IMAGE_TIMEOUT_MS`. 예시값 15분 |
| (선택) nginx | `proxy_read_timeout` 등 20분, 업로드 크기 50MB |

**nginx를 앞에 둘 때:** 대기시간은 최소 10분 이상, 그리고 `LOCAL_IMAGE_TIMEOUT_MS`보다 길게 둔다. nginx 기본값 60초로 두면 오늘 막혔던 것과 같은 방식으로 생성 도중에 끊긴다. 업로드 기본 한도(1MB)도 늘려야 한다. 그대로면 참고 이미지가 413으로 막힌다.

## http 전제

https 없이 `http://<서버 IP>:3000`으로 동작한다.

알려진 한계가 하나 있다. 배너 화면의 **색상 코드 복사 버튼**은 브라우저 보안 규칙상 http에서는 동작하지 않을 수 있다. 나머지 기능에는 영향이 없다.

## 업데이트

```bash
cd /opt/planmaker
git pull
npm ci
VITE_PLANMAKER_SURFACE=studio npm run build
node selfhost/build-api.mjs
sudo systemctl restart planmaker
```

재시작하는 순간 진행 중이던 생성은 끊긴다.

## 주소 변경에 따른 영향 (합의된 사항)

PLANMAKER는 작업을 각 팀원 브라우저에 **주소별로** 저장한다. 따라서 새 주소에서는 기존 Vercel 주소의 작업이 보이지 않고 빈 상태에서 시작한다.

## 서버 쪽에서 해야 할 보안 조치 (이 폴더에서는 하지 않음)

1. **ComfyUI(8188) 외부 차단.** 지금 `0.0.0.0:8188`로 열려 있어 사내망 누구나 직접 접근할 수 있다. 둘 중 하나를 적용한다.
   - ComfyUI 실행 옵션에서 `--listen`을 빼거나 `--listen 127.0.0.1`로 바꾼다.
   - 방화벽(ufw 등)으로 8188의 외부 접근을 막는다.
   - 적용 전에 어댑터가 ComfyUI를 `127.0.0.1:8188`로 부르는지 확인한다.
2. **어댑터(8787)는 지금처럼 `127.0.0.1`에만 묶어 둔다.**
3. **사내망에는 PLANMAKER 포트만 연다.** 3000, 또는 nginx를 쓰면 80.
4. **설정 파일 보호.** `/etc/planmaker/planmaker.env`는 `chmod 600`으로 두고 저장소에 넣지 않는다.
5. **Windows PC의 MobaXterm 8787 터널 정리.** 서버로 옮긴 뒤에는 필요 없으니 끈다. 그 터널은 PC의 모든 주소(`0.0.0.0:8787`)에 열려 있었다.
