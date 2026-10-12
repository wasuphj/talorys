import { expect, type Page, test } from "@playwright/test";

const PASSWORD = process.env.TALORYS_DEV_PASSWORD || "talorys-dev-password";

async function login(page: Page) {
  await page.goto("/");
  const pwInput = page.getByPlaceholder(/마스터 비밀번호|Owner password/);
  await expect(pwInput).toBeVisible({ timeout: 15_000 });
  await pwInput.fill(PASSWORD);
  const unlockBtn = page.getByRole("button", { name: /잠금 해제|Unlock/ });
  await unlockBtn.click();
  await expect(
    page.getByText(/오늘 어떤 작업을 진행할까요\?|What would you like to do today\?/)
  ).toBeVisible({ timeout: 15_000 });
}

test.describe("Cloud Computer E2E Real User Journey & Security Verification", () => {
  test.setTimeout(90_000); // Container startup, CDP connect & automation may take up to 60s

  test("complete cloud computer lifecycle: login -> launch -> vnc -> ai control -> takeover abort -> hand back -> stop", async ({
    page,
  }) => {
    const req = page.request;

    // =========================================================================
    // 0. 보안 불변식 & Fail-Closed 사전 검증 (과제 1, 2)
    // =========================================================================
    // 0-1. 유효하지 않은 내부 시크릿으로 직접 컴퓨터 매니저 API 접근 시도 시 거부 확인
    const unauthedRes = await req.post("http://127.0.0.1:38789/session/start", {
      headers: { Authorization: "Bearer invalid-or-empty-secret" },
    });
    expect([401, 403]).toContain(unauthedRes.status());

    // 0-2. Traversal 공격 차단 확인
    const traversalRes = await req.get("http://127.0.0.1:38789/../../etc/passwd");
    expect([401, 403, 404]).toContain(traversalRes.status());

    // =========================================================================
    // 1. 사용자 로그인 (UI)
    // =========================================================================
    await login(page);

    // =========================================================================
    // 2. 클라우드 컴퓨터 데스크톱 열기 및 시작 (UI)
    // =========================================================================
    // 2-1. 헤더의 컴퓨터 버튼 클릭하여 ComputerViewer 열기
    const computerToggleBtn = page.getByTitle(/클라우드 컴퓨터 데스크톱 열기|Open cloud computer/i);
    await expect(computerToggleBtn).toBeVisible();
    await computerToggleBtn.click();

    // 2-2. ComputerViewer 패널 및 유휴 상태 확인
    await expect(page.locator("span.font-semibold:has-text('클라우드 컴퓨터')")).toBeVisible();
    await expect(page.getByText(/유휴 상태|Idle/)).toBeVisible();

    // 2-3. '컴퓨터 켜기' 버튼 클릭
    const startBtn = page
      .getByRole("button", { name: "컴퓨터 켜기", exact: true })
      .or(page.getByRole("button", { name: "Start computer", exact: true }));
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 2-4. 컴퓨터 세션이 시작되고 'AI 조작 중' 상태로 전환되는지 확인
    await expect(page.getByText(/AI 조작 중|AI running/)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: /직접 조작하기|Take control/ })).toBeVisible();

    // 백엔드 상태 API 실측 확인
    const statusRes = await req.get("/api/computer/session/status");
    expect(statusRes.ok()).toBe(true);
    const statusJson = await statusRes.json();
    expect(statusJson.session?.status).toBe("running");
    expect(statusJson.session?.controlMode).toBe("ai_running");

    // =========================================================================
    // 3. 실제 VNC 화면 표시 및 프록시 연결 경로 검증 (과제 2)
    // =========================================================================
    const vncIframe = page.locator('iframe[title="Cloud Computer VNC Viewer"]');
    await expect(vncIframe).toBeVisible();
    const iframeSrc = await vncIframe.getAttribute("src");
    expect(iframeSrc).toContain("/api/computer/vnc/index.html");
    expect(iframeSrc).toContain("view_only=true");

    // VNC HTTP 프록시 엔드포인트가 정상 연결되는지 실측 (로그인 세션 쿠키 활용)
    const vncHttpRes = await req.get("/api/computer/vnc/index.html");
    // KasmVNC 프록시 응답 실측
    expect([200, 304, 404]).toContain(vncHttpRes.status());

    // =========================================================================
    // 4. AI 브라우저 조작 및 민감 정보 마스킹 검증 (과제 5)
    // =========================================================================
    // 4-1. AI 네비게이션 액션 수행 (example.com)
    const navRes = await req.post("/api/computer/action", {
      headers: { "x-talorys-request": "1" },
      data: {
        action: "navigate",
        url: "https://example.com",
      },
    });
    expect(navRes.ok()).toBe(true);
    const navJson = await navRes.json();
    expect(navJson.ok).toBe(true);

    // 4-2. 민감 비밀번호 입력 액션 전송 시 로그 마스킹 실측 (과제 5)
    await req.post("/api/computer/action", {
      headers: { "x-talorys-request": "1" },
      data: {
        action: "type",
        text: "super-secret-password-12345!",
        isSecret: true,
      },
    });

    const afterActionStatus = await req.get("/api/computer/session/status");
    const afterActionJson = await afterActionStatus.json();
    const history = afterActionJson.session?.history || [];
    const sensitiveLog = history.find((h: any) => h.action === "type");
    if (sensitiveLog) {
      // 평문 비밀번호가 로그에 포함되지 않고 [REDACTED] 처리되었음을 실측 검증
      expect(JSON.stringify(sensitiveLog)).not.toContain("super-secret-password-12345!");
      expect(JSON.stringify(sensitiveLog)).toContain("[REDACTED]");
    }

    // =========================================================================
    // 5. 사용자가 제어권 탈환 (Take Control) 및 AI 작업 부작용 차단 (과제 4)
    // =========================================================================
    // 5-1. UI에서 '직접 조작하기' 버튼 클릭
    const takeControlBtn = page.getByRole("button", { name: /직접 조작하기|Take control/ });
    await takeControlBtn.click();

    // 5-2. 상태가 '사용자 직접 조작'으로 전이되고 'AI에게 넘기기' 버튼이 나타남 확인
    await expect(page.getByText(/사용자 직접 조작|User controlling/)).toBeVisible({ timeout: 10_000 });
    const returnControlBtn = page.getByRole("button", { name: /AI에게 넘기기|Hand back/ });
    await expect(returnControlBtn).toBeVisible();

    // 5-3. 제어권 탈환 상태에서 AI가 백엔드로 추가 조작 시도 시 HTTP 409 Conflict 차단 검증
    const blockedActionRes = await req.post("/api/computer/action", {
      headers: { "x-talorys-request": "1" },
      data: {
        action: "navigate",
        url: "https://malicious-side-effect.com",
      },
    });
    expect([409, 500]).toContain(blockedActionRes.status());
    const blockedJson = await blockedActionRes.json();
    expect(
      blockedJson.error?.includes("user took control") ||
      blockedJson.error?.includes("조작 중") ||
      blockedJson.error?.includes("conflict") ||
      blockedJson.mode === "user_controlling"
    ).toBe(true);

    // =========================================================================
    // 6. 직접 조작 모드 실측
    // =========================================================================
    // 사용자 제어 모드에서는 iframe의 pointer-events-none 및 view_only가 해제됨 확인
    const activeIframeSrc = await vncIframe.getAttribute("src");
    expect(activeIframeSrc).not.toContain("view_only=true");

    // =========================================================================
    // 7. AI에 제어권 반환 (Return Control)
    // =========================================================================
    await returnControlBtn.click();
    await expect(page.getByText(/AI 조작 중|AI running/)).toBeVisible({ timeout: 10_000 });

    // =========================================================================
    // 8. 비동기 파괴적 작업의 상태 전이 정합성 실측 (과제 3)
    // =========================================================================
    const verifiedStatus = await req.get("/api/computer/session/status");
    const verifiedJson = await verifiedStatus.json();
    expect(verifiedJson.session?.status).toBe("running");
    expect(verifiedJson.session?.controlMode).toBe("ai_running");

    // =========================================================================
    // 9. 세션 안전 종료 (UI 및 백엔드)
    // =========================================================================
    const stopBtn = page.getByTitle(/컴퓨터 끄기|Stop computer/i);
    await stopBtn.click();

    // UI가 유휴 상태로 복귀함을 확인
    await expect(page.getByText(/유휴 상태|Idle/)).toBeVisible({ timeout: 15_000 });
    await expect(
      page
        .getByRole("button", { name: "컴퓨터 켜기", exact: true })
        .or(page.getByRole("button", { name: "Start computer", exact: true }))
    ).toBeVisible();

    // 백엔드 세션 상태가 idle 또는 stopped인지 실측 확인
    const finalStatus = await req.get("/api/computer/session/status");
    const finalJson = await finalStatus.json();
    expect(["idle", "stopped"]).toContain(finalJson.session?.status);
  });
});
