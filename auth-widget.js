/**
 * auth-widget.js
 * 페이지 우측 상단 로그인 UI. `.auth-slot` 컨테이너가 있는 페이지라면 어디서든
 * `<script type="module" src="auth-widget.js"></script>` 한 줄만 추가하면 동작한다.
 *
 * - 로그아웃 상태: "로그인" 버튼 → 클릭 시 이메일/비밀번호 모달(로그인/회원가입)
 * - 로그인 상태: "{이메일 앞부분}님 로그아웃" 표시
 * - 새로고침해도 로그인 상태 유지(auth.js가 Supabase 세션을 복원)
 * - 실제 인증 로직/에러 메시지는 전부 auth.js(Supabase 래퍼)에 위임한다.
 */

import { onAuthChange, signIn, signUp, signOut } from "./auth.js";

const slots = document.querySelectorAll(".auth-slot");

let overlay = null;
let form = null;
let emailInput = null;
let passwordInput = null;
let errorEl = null;
let hintEl = null;
let loginBtn = null;
let signupBtn = null;
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
      <form class="auth-modal__form" novalidate>
        <label class="auth-modal__label" for="auth-modal-email">이메일</label>
        <input class="auth-modal__input" type="email" id="auth-modal-email" autocomplete="email" required>
        <label class="auth-modal__label" for="auth-modal-password">비밀번호</label>
        <input class="auth-modal__input" type="password" id="auth-modal-password" autocomplete="current-password" minlength="6" required>
        <p class="auth-modal__error" hidden></p>
        <div class="auth-modal__actions">
          <button type="submit" class="btn btn-primary btn-sm auth-modal__login-btn">로그인</button>
          <button type="button" class="btn btn-ghost btn-sm auth-modal__signup-btn">회원가입</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  form = overlay.querySelector(".auth-modal__form");
  emailInput = overlay.querySelector("#auth-modal-email");
  passwordInput = overlay.querySelector("#auth-modal-password");
  errorEl = overlay.querySelector(".auth-modal__error");
  hintEl = overlay.querySelector(".auth-modal__hint");
  loginBtn = overlay.querySelector(".auth-modal__login-btn");
  signupBtn = overlay.querySelector(".auth-modal__signup-btn");

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
}

/** overlay 안의 포커스 가능한 요소들(Tab 순서대로). */
function getFocusable() {
  return Array.from(overlay.querySelectorAll("input, button")).filter(
    (el) => !el.disabled && el.tabIndex !== -1
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
  clearError();
  form.reset();
  hintEl.textContent = hint || "";
  hintEl.hidden = !hint;
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

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
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

  clearError();
  setPending(true);
  activeBtn.textContent = pendingLabel;

  try {
    await action(email, password);
    closeModal();
  } catch (err) {
    showError(err.message || "알 수 없는 오류가 발생했습니다.");
  } finally {
    setPending(false);
    activeBtn.textContent = idleLabel;
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
