// --- Form state -----------------------------------------------------------

const fields = {
  name: document.getElementById('name'),
  email: document.getElementById('email'),
  phone: document.getElementById('phone'),
};

function highlight(el) {
  el.classList.remove('field-highlight');
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth; // restart the CSS animation
  el.classList.add('field-highlight');
}

function setField(el, value) {
  el.value = value;
  highlight(el);
}

// --- Validation -------------------------------------------------------

function checkName(name) {
  const raw = String(name || '').trim();
  if (!raw) return { valid: false, reason: 'Name is required.' };
  if (raw.length < 2) return { valid: false, reason: 'Name must be at least 2 characters.' };
  if (!/^[\p{L} '-]+$/u.test(raw)) {
    return { valid: false, reason: 'Name can only contain letters, spaces, hyphens and apostrophes.' };
  }
  return { valid: true, reason: null };
}

function checkEmail(email) {
  const raw = String(email || '').trim();
  if (!raw) return { valid: false, reason: 'Email is required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { valid: false, reason: 'Email must look like name@example.com.' };
  }
  return { valid: true, reason: null };
}

// Accepts an optional leading '+' and 7-15 digits, ignoring spaces/dashes/parens
// (loosely modeled on E.164, good enough for a demo).
function checkPhoneNumber(phoneNumber) {
  const raw = String(phoneNumber || '').trim();
  if (!raw) return { valid: false, reason: 'Phone number is required.' };

  const stripped = raw.replace(/[\s()-]/g, '');
  if (!/^\+?\d+$/.test(stripped)) {
    return { valid: false, reason: 'Phone number must contain only digits, spaces, dashes, or a leading +.' };
  }

  const digits = stripped.replace('+', '');
  if (digits.length < 7 || digits.length > 15) {
    return { valid: false, reason: 'Phone number must have between 7 and 15 digits.' };
  }

  return { valid: true, reason: null };
}

// --- Shared feedback rendering ----------------------------------------

function renderFieldFeedback(fieldEl, feedbackId, result) {
  const feedback = document.getElementById(feedbackId);
  fieldEl.classList.remove('valid', 'invalid');
  feedback.classList.remove('valid', 'invalid');

  if (result.valid) {
    fieldEl.classList.add('valid');
    feedback.classList.add('valid');
    feedback.textContent = 'Looks good.';
  } else {
    fieldEl.classList.add('invalid');
    feedback.classList.add('invalid');
    feedback.textContent = result.reason;
  }
}

// --- Tool handlers (shared by real UI and by WebMCP) -----------------------

function validateName({ name }) {
  setField(fields.name, name !== undefined ? name : fields.name.value);
  const result = checkName(fields.name.value);
  renderFieldFeedback(fields.name, 'name-feedback', result);
  return result;
}

function validateEmail({ email }) {
  setField(fields.email, email !== undefined ? email : fields.email.value);
  const result = checkEmail(fields.email.value);
  renderFieldFeedback(fields.email, 'email-feedback', result);
  return result;
}

function validatePhoneNumber({ phoneNumber }) {
  setField(fields.phone, phoneNumber !== undefined ? phoneNumber : fields.phone.value);
  const result = checkPhoneNumber(fields.phone.value);
  renderFieldFeedback(fields.phone, 'phone-feedback', result);
  return result;
}

function submitRegistration() {
  const statusEl = document.getElementById('registration-status');
  const name = fields.name.value.trim();
  const email = fields.email.value.trim();
  const phone = fields.phone.value.trim();

  const nameResult = checkName(name);
  renderFieldFeedback(fields.name, 'name-feedback', nameResult);

  const emailResult = checkEmail(email);
  renderFieldFeedback(fields.email, 'email-feedback', emailResult);

  const phoneResult = checkPhoneNumber(phone);
  renderFieldFeedback(fields.phone, 'phone-feedback', phoneResult);

  const errors = [nameResult, emailResult, phoneResult].filter((r) => !r.valid).map((r) => r.reason);

  if (errors.length > 0) {
    statusEl.textContent = `Cannot register: ${errors.join(', ')}`;
    statusEl.className = 'error';
    return { success: false, errors };
  }

  statusEl.textContent = `Registered! Welcome, ${name}.`;
  statusEl.className = 'success';
  return { success: true, name, email, phone };
}

// --- Tool registry -------------------------------------------------------

const toolsMeta = [
  {
    name: "validateName",
    description: "Validate a full name and show the result on the form. Pass the name to check.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"]
    },
    handler: (input) => validateName(input)
  },
  {
    name: "validateEmail",
    description: "Validate an email address and show the result on the form. Pass the email to check.",
    inputSchema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"]
    },
    handler: (input) => validateEmail(input)
  },
  {
    name: "validatePhoneNumber",
    description: "Validate a phone number and show the result on the form. Pass the number to check.",
    inputSchema: {
      type: "object",
      properties: { phoneNumber: { type: "string" } },
      required: ["phoneNumber"]
    },
    handler: (input) => validatePhoneNumber(input)
  },
  {
    name: "submitRegistration",
    description: "Validate and submit the registration form using whatever has been filled in so far.",
    inputSchema: { type: "object", properties: {}, required: [] },
    handler: () => submitRegistration()
  },
  {
    name: "getWelcomeGift",
    description: `Returns the special welcome gift a user will receive
      if they register on this website.
      Use this tool when the user asks about gifts, rewards,
      perks, or benefits for registering.
    `,
    inputSchema: {
      type: "object",
      properties: {}
    },
    handler: async () => {
      return "🎁 One free production bug. It never expires.";
    }
  }
];

// The API has moved between navigator.modelContext and document.modelContext
// across Chrome versions while WebMCP is still in flux, so check both hosts
// rather than hard-coding one.
function findModelContextHost() {
  return navigator?.modelContext || document?.modelContext || null;
}

function registerWebMcpTools() {
  const modelContext = findModelContextHost();
  if (!modelContext) return false;

  for (const tool of toolsMeta) {
    try {
      modelContext.registerTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (input) => tool.handler(input || {}),
      });
    } catch (err) {
      console.warn(`registerTool(${tool.name}) failed:`, err);
    }
  }
}

// --- Init ------------------------------------------------------------------

function init() {
  registerWebMcpTools();
  document.getElementById('submit-btn').addEventListener('click', () => submitRegistration());
}

init();
