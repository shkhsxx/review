/**
 * reset-password.js
 * reset-password.html 전용 로직. Supabase가 이메일 링크의 복구 토큰으로
 * 세션을 자동 생성해주므로(auth.js에서 client 생성 시 기본 동작), 그 세션이
 * 있으면 새 비밀번호 입력 폼을, 없으면(만료/잘못된 링크) 안내 문구를 보여준다.
 */

import { waitForAuthReady, updatePassword } from "./auth.js";

const invalidEl = document.getElementById("reset-invalid");
const form = document.getElementById("reset-form");
const passwordInput = document.getElementById("reset-password-input");
const confirmInput = document.getElementById("reset-confirm-input");
const errorEl = document.getElementById("reset-error");
const submitBtn = document.getElementById("reset-submit-btn");
const successEl = document.getElementById("reset-success");

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

waitForAuthReady().then((user) => {
  if (!user) {
    form.hidden = true;
    invalidEl.hidden = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const password = passwordInput.value;
  const confirm = confirmInput.value;

  if (password.length < 6) {
    showError("비밀번호는 6자 이상이어야 합니다.");
    return;
  }
  if (password !== confirm) {
    showError("비밀번호가 서로 일치하지 않습니다.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "변경 중...";

  try {
    await updatePassword(password);
    form.hidden = true;
    successEl.hidden = false;
  } catch (err) {
    showError(err.message || "알 수 없는 오류가 발생했습니다.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "비밀번호 변경";
  }
});
