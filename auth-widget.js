/**
 * auth-widget.js
 * 페이지 우측 상단 로그인 UI. `.auth-slot` 컨테이너가 있는 페이지라면 어디서든
 * `<script type="module" src="auth-widget.js"></script>` 한 줄만 추가하면 동작한다.
 *
 * - 로그아웃 상태: "로그인" 버튼 → 클릭 시 이메일/비밀번호 모달(로그인/회원가입)
 *   모달 안에는 "아이디 찾기"/"비밀번호 찾기" 링크가 있어 같은 모달 안에서 뷰만 전환된다.
 *   (아이디는 곧 가입 이메일이라 "아이디 찾기"는 안내 문구만 보여준다. "비밀번호 찾기"는
 *   Supabase의 이메일 재설정 링크를 실제로 발송하며, reset-password.html에서 새 비밀번호를 설정한다.)
 * - 로그인 상태: "{이메일 앞부분}님 로그아웃" 표시
 * - 새로고침해도 로그인 상태 유지(auth.js가 Supabase 세션을 복원)
 * - 실제 인증 로직/에러 메시지는 전부 auth.js(Supabase 래퍼)에 위임한다.
 */

import { onAuthChange, signIn, signUp, signOut, resetPasswordForEmail } from "./auth.js";

const VIEW_TITLES = {
  login: "로그인 · 회원가입",
  "find-id": "아이디 찾기",
  "find-password": "비밀번호 찾기",
};

const slots = document.querySelectorAll(".auth-slot");

let overlay = null;
let titleEl = null;
let hintEl = null;
let form = null;
let emailInput = null;
let passwordInput = null;
let errorEl = null;
let loginBtn = null;
let signupBtn = null;
let findIdPanel = null;
let resetForm = null;
let resetEmailInput = null;
let resetErrorEl = null;
let resetSuccessEl = null;
let resetBtn = null;
let lastFocusedEl = null;

function displayName(user) {
  return user.email ? user.email.split("@")[0] : "회원";
}

function renderSlots(user) {
  slots.forEach((slot) => {
    slot.innerHTML = "";
    if (user) {
      const wrap = document.createElement("span");
      wrap.className = "auth-slot__user";

      const name = document.createElement("span");
      name.className = "auth-slot__name";
      name.textContent = `${displayName(user)}님`;

      const logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "auth-slot__logout-btn";
      logoutBtn.textContent = "로그아웃";
      logoutBtn.addEventListener("click", handleLogout);

      wrap.appendChild(name);
      wrap.appendChild(logoutBtn);
      slot.appendChild(wrap);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost btn-sm auth-slot__login-btn";
      btn.textContent = "로그인";
      btn.addEventListener("click", () => openModal());
      slot.appendChild(btn);
    }
  });
}

function buildModal() {
  overlay = document.createElement("div");
  overlay.className = "auth-modal-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <button type="button" class="auth-modal__close-btn" aria-label="닫기">✕</button>
      <h2 class="auth-modal__title" id="auth-modal-title">로그인 · 회원가입</h2>
      <p class="auth-modal__hint" hidden></p>

      <form class="auth-modal__form" data-view="login" novalidate>
        <label class="auth-modal__label" for="auth-modal-email">이메일</label>
        <input class="auth-modal__input" type="email" id="auth-modal-email" autocomplete="email" required>
        <label class="auth-modal__label" for="auth-modal-password">비밀번호</label>
        <input class="auth-modal__input" type="password" id="auth-modal-password" autocomplete="current-password" minlength="6" required>
        <p class="auth-modal__error" hidden></p>
        <div class="auth-modal__actions">
          <button type="submit" class="btn btn-primary btn-sm auth-modal__login-btn">로그인</button>
          <button type="button" class="btn btn-ghost btn-sm auth-modal__signup-btn">회원가입</button>
        </div>
        <div class="auth-modal__links">
          <button type="button" class="auth-modal__link-btn" data-goto="find-id">아이디 찾기</button>
          <span class="auth-modal__links-divider" aria-hidden="true">·</span>
          <button type="button" class="auth-modal__link-btn" data-goto="find-password">비밀번호 찾기</button>
        </div>
      </form>

      <div class="auth-modal__panel" data-view="find-id" hidden>
        <p class="auth-modal__panel-text">오늘뭐먹지는 가입할 때 사용한 <strong>이메일 주소</strong>를 아이디로 사용해요. 가입 시 입력한 이메일로 로그인해주세요.</p>
        <button type="button" class="auth-modal__link-btn" data-goto="login">← 로그인으로 돌아가기</button>
      </div>

      <form class="auth-modal__panel" data-view="find-password" novalidate hidden>
        <p class="auth-modal__panel-text">가입한 이메일을 입력하면 비밀번호 재설정 링크를 보내드려요.</p>
        <label class="auth-modal__label" for="auth-modal-reset-email">이메일</label>
        <input class="auth-modal__input" type="email" id="auth-modal-reset-email" autocomplete="email" required>
        <p class="auth-modal__error" hidden></p>
        <p class="auth-modal__success" hidden></p>
        <div class="auth-modal__actions">
          <button type="submit" class="btn btn-primary btn-sm auth-modal__reset-btn">재설정 링크 보내기</button>
        </div>
        <button type="button" class="auth-modal__link-btn" data-goto="login">← 로그인으로 돌아가기</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  titleEl = overlay.querySelector("#auth-modal-title");
  hintEl = overlay.querySelector(".auth-modal__hint");

  form = overlay.querySelector('[data-view="login"]');
  emailInput = overlay.querySelector("#auth-modal-email");
  passwordInput = overlay.querySelector("#auth-modal-password");
  errorEl = form.querySelector(".auth-modal__error");
  loginBtn = overlay.querySelector(".auth-modal__login-btn");
  signupBtn = overlay.querySelector(".auth-modal__signup-btn");

  findIdPanel = overlay.querySelector('[data-view="find-id"]');

  resetForm = overlay.querySelector('[data-view="find-password"]');
  resetEmailInput = overlay.querySelector("#auth-modal-reset-email");
  resetErrorEl = resetForm.querySelector(".auth-modal__error");
  resetSuccessEl = resetForm.querySelector(".auth-modal__success");
  resetBtn = overlay.querySelector(".auth-modal__reset-btn");

  overlay.querySelector(".auth-modal__close-btn").addEventListener("click", closeModal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (overlay.hidden) return;
    if (event.key === "Escape") {
      closeModal();
      return;
    }
    if (event.key === "Tab") trapFocus(event);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSubmit(signIn, "로그인 중...", "로그인");
  });
  signupBtn.addEventListener("click", () => {
    handleSubmit(signUp, "가입 중...", "회원가입");
  });

  overlay.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.goto));
  });

  resetForm.addEventListener("submit", handleResetSubmit);
}

/** 모달 안에서 로그인/아이디 찾기/비밀번호 찾기 뷰를 전환한다(모달을 새로 열지 않음). */
function switchView(view) {
  form.hidden = view !== "login";
  findIdPanel.hidden = view !== "find-id";
  resetForm.hidden = view !== "find-password";
  hintEl.hidden = view !== "login" || !hintEl.textContent;
  titleEl.textContent = VIEW_TITLES[view];
  clearError(errorEl);
  clearError(resetErrorEl);
  resetSuccessEl.hidden = true;

  const focusTarget = { login: emailInput, "find-id": findIdPanel.querySelector(".auth-modal__link-btn"), "find-password": resetEmailInput }[view];
  focusTarget?.focus();
}

/** overlay 안의 포커스 가능한 요소들(Tab 순서대로). 숨겨진 뷰(다른 view의 폼/패널) 안의 요소는 제외한다. */
function getFocusable() {
  return Array.from(overlay.querySelectorAll("input, button")).filter(
    (el) => !el.disabled && el.tabIndex !== -1 && el.offsetParent !== null
  );
}

/** 모달이 열려 있는 동안 Tab이 배경 요소로 빠져나가지 않도록 첫/마지막 요소 사이를 순환시킨다. */
function trapFocus(event) {
  const focusable = getFocusable();
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openModal(hint) {
  if (!overlay) buildModal();
  form.reset();
  resetForm.reset();
  hintEl.textContent = hint || "";
  switchView("login");
  lastFocusedEl = document.activeElement;
  overlay.hidden = false;
  emailInput.focus();
}

/** 다른 모듈(예: 로그인이 필요한 "담기" 버튼)에서 안내 문구와 함께 로그인 모달을 연다. */
export function promptLogin(hint) {
  openModal(hint);
}

function closeModal() {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  if (lastFocusedEl && document.body.contains(lastFocusedEl)) lastFocusedEl.focus();
  lastFocusedEl = null;
}

function clearError(el) {
  el.hidden = true;
  el.textContent = "";
}

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function setPending(pending) {
  loginBtn.disabled = pending;
  signupBtn.disabled = pending;
}

async function handleSubmit(action, pendingLabel, idleLabel) {
  if (!form.reportValidity()) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const activeBtn = action === signIn ? loginBtn : signupBtn;

  clearError(errorEl);
  setPending(true);
  activeBtn.textContent = pendingLabel;

  try {
    await action(email, password);
    closeModal();
  } catch (err) {
    showError(errorEl, err.message || "알 수 없는 오류가 발생했습니다.");
  } finally {
    setPending(false);
    activeBtn.textContent = idleLabel;
  }
}

/** "비밀번호 찾기" 뷰: 입력한 이메일로 Supabase 비밀번호 재설정 링크를 보낸다. */
async function handleResetSubmit(event) {
  event.preventDefault();
  if (!resetForm.reportValidity()) return;

  const email = resetEmailInput.value.trim();

  clearError(resetErrorEl);
  resetSuccessEl.hidden = true;
  resetBtn.disabled = true;
  resetBtn.textContent = "보내는 중...";

  try {
    const redirectTo = new URL("reset-password.html", location.href).toString();
    await resetPasswordForEmail(email, redirectTo);
    resetSuccessEl.textContent = "재설정 링크를 이메일로 보냈어요. 받은 편지함을 확인해주세요.";
    resetSuccessEl.hidden = false;
  } catch (err) {
    showError(resetErrorEl, err.message || "알 수 없는 오류가 발생했습니다.");
  } finally {
    resetBtn.disabled = false;
    resetBtn.textContent = "재설정 링크 보내기";
  }
}

async function handleLogout() {
  try {
    await signOut();
  } catch (err) {
    console.error("[auth-widget.js] 로그아웃 실패:", err);
  }
}

if (slots.length) {
  onAuthChange((user) => {
    renderSlots(user);
    if (user) closeModal();
  });
}
