type ValidatedElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const ERROR_CLASS = "field-invalid";
const SHAKE_CLASS = "field-shake";

function isValidated(element: Element): element is ValidatedElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function formatLimit(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("ko-KR") : value;
}

/** Range check for the comma-formatted text inputs, which the browser does not range-check. */
function textNumberRangeMessage(element: ValidatedElement) {
  if (!(element instanceof HTMLInputElement) || element.type !== "text" || !element.inputMode) return null;
  const raw = element.value.replaceAll(",", "").trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return "숫자로 입력해 주세요.";
  const min = element.getAttribute("min");
  const max = element.getAttribute("max");
  if (min !== null && value < Number(min)) return `${formatLimit(min)} 이상 입력해 주세요.`;
  if (max !== null && value > Number(max)) return `${formatLimit(max)} 이하로 입력해 주세요.`;
  return null;
}

function validationMessage(element: ValidatedElement) {
  const { validity } = element;
  if (validity.valueMissing) {
    if (element instanceof HTMLInputElement && element.type === "checkbox") return "동의가 필요합니다.";
    if (element instanceof HTMLInputElement && element.type === "radio") return "항목을 선택해 주세요.";
    return "필수 입력 항목입니다.";
  }
  if (validity.typeMismatch) return "올바른 형식으로 입력해 주세요.";
  if (validity.tooShort) return `${element.getAttribute("minlength")}자 이상 입력해 주세요.`;
  if (validity.tooLong) return `${element.getAttribute("maxlength")}자 이하로 입력해 주세요.`;
  if (validity.rangeUnderflow) return `${formatLimit(element.getAttribute("min") ?? "")} 이상 입력해 주세요.`;
  if (validity.rangeOverflow) return `${formatLimit(element.getAttribute("max") ?? "")} 이하로 입력해 주세요.`;
  if (validity.stepMismatch || validity.badInput) return "올바른 값을 입력해 주세요.";
  if (!validity.valid) return element.validationMessage || "입력값을 확인해 주세요.";
  return textNumberRangeMessage(element);
}

function fieldContainer(element: Element) {
  return element.closest<HTMLElement>(".field, .terms-agreement, .roadmap-editor-field") ?? element.parentElement;
}

function errorNode(container: HTMLElement) {
  const next = container.classList.contains("field") ? container.lastElementChild : container.nextElementSibling;
  return next instanceof HTMLElement && next.dataset.fieldError === "true" ? next : null;
}

export function clearFieldError(element: Element) {
  const container = fieldContainer(element);
  if (!container) return;
  container.classList.remove(ERROR_CLASS, SHAKE_CLASS);
  errorNode(container)?.remove();
  if (isValidated(element)) element.removeAttribute("aria-invalid");
}

function showFieldError(element: ValidatedElement, message: string) {
  const container = fieldContainer(element);
  if (!container) return;
  let node = errorNode(container);
  if (!node) {
    node = document.createElement("p");
    node.className = "field-error";
    node.dataset.fieldError = "true";
    node.setAttribute("role", "alert");
    if (container.classList.contains("field")) container.append(node);
    else container.after(node);
  }
  node.textContent = message;
  element.setAttribute("aria-invalid", "true");
  container.classList.add(ERROR_CLASS);
  // Restart the shake animation on every failed submit.
  container.classList.remove(SHAKE_CLASS);
  void container.offsetWidth;
  container.classList.add(SHAKE_CLASS);
}

/**
 * Validates every enabled control in the form and shows inline errors instead of the browser bubbles.
 * Returns whether the form is valid; focuses the first invalid control otherwise.
 */
export function validateFormFields(form: HTMLFormElement) {
  let firstInvalid: ValidatedElement | null = null;
  for (const element of Array.from(form.elements)) {
    if (!isValidated(element) || element.disabled || element.type === "hidden") continue;
    const message = validationMessage(element);
    if (message) {
      showFieldError(element, message);
      firstInvalid ??= element;
    } else {
      clearFieldError(element);
    }
  }
  firstInvalid?.focus({ preventScroll: false });
  return firstInvalid === null;
}
