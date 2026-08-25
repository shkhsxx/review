/**
 * toast.js
 * 화면 하단에 잠깐 떴다 사라지는 안내 토스트. 주로 "삭제/취소 + 되돌리기" 용도로 쓴다
 * (삭제 자체는 바로 실행하되, 몇 초 안에 되돌릴 수 있게 해서 확인창 없이도 안전하게 만든다).
 *
 * 사용법: showUndoToast("삭제했어요", () => { ...되돌리는 동작... });
 */

const DURATION_MS = 5000;

let container = null;
let hideTimer = null;

function ensureContainer() {
  if (!container) {
    container = document.createElement("div");
    container.className = "toast";
    container.hidden = true;
    container.setAttribute("role", "status");
    document.body.appendChild(container);
  }
  return container;
}

function hideToast() {
  if (!container) return;
  container.classList.remove("toast--show");
  clearTimeout(hideTimer);
  setTimeout(() => {
    if (container) container.hidden = true;
  }, 200);
}

/** message와 함께 "되돌리기" 버튼이 있는 토스트를 띄운다. onUndo는 되돌리기 클릭 시 호출된다. */
export function showUndoToast(message, onUndo) {
  const el = ensureContainer();
  clearTimeout(hideTimer);
  el.innerHTML = "";

  const text = document.createElement("span");
  text.className = "toast__text";
  text.textContent = message;
  el.appendChild(text);

  const undoBtn = document.createElement("button");
  undoBtn.type = "button";
  undoBtn.className = "toast__undo-btn";
  undoBtn.textContent = "되돌리기";
  undoBtn.addEventListener("click", () => {
    hideToast();
    onUndo();
  });
  el.appendChild(undoBtn);

  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("toast--show"));
  hideTimer = setTimeout(hideToast, DURATION_MS);
}
