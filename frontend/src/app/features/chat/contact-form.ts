export const CONTACT_FORM_VERSION = '1' as const;
export const CONTACT_SUBMISSION_VERSION = '1' as const;
export const CONTACT_FIELDS = ['name', 'email', 'company', 'message'] as const;
export const CONTACT_LIMITS = { name: 80, email: 254, company: 120, message: 2000 } as const;

export type ContactIntent = 'employment' | 'interview' | 'recruiting';
export type ContactField = (typeof CONTACT_FIELDS)[number];
export type ContactDraft = { name: string; email: string; company: string; message: string };
export type InterviewContactFormPart = {
  type: 'interview_contact_form';
  form_version: typeof CONTACT_FORM_VERSION;
  submission_version: typeof CONTACT_SUBMISSION_VERSION;
  intent: ContactIntent;
  fields: typeof CONTACT_FIELDS;
};
export type ContactOutcome =
  | 'accepted'
  | 'duplicate_accepted'
  | 'duplicate_processing'
  | 'delivery_uncertain'
  | 'validation_error'
  | 'unsupported_version'
  | 'idempotency_conflict'
  | 'throttled'
  | 'delivery_unavailable'
  | 'delivery_retryable'
  | 'delivery_failed';
export type ContactSubmissionResponse = {
  outcome: ContactOutcome;
  retryable: boolean;
  request_id: string;
  field_errors?: Partial<Record<ContactField, string>>;
};
export type ContactFormState =
  | 'closed'
  | 'editing'
  | 'submitting'
  | 'success'
  | 'duplicate'
  | 'validation-error'
  | 'retryable-failure'
  | 'uncertain'
  | 'unavailable';

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OUTCOMES = new Set<ContactOutcome>([
  'accepted',
  'duplicate_accepted',
  'duplicate_processing',
  'delivery_uncertain',
  'validation_error',
  'unsupported_version',
  'idempotency_conflict',
  'throttled',
  'delivery_unavailable',
  'delivery_retryable',
  'delivery_failed',
]);

export function emptyContactDraft(): ContactDraft {
  return { name: '', email: '', company: '', message: '' };
}

export function validateContactDraft(draft: ContactDraft): Partial<Record<ContactField, string>> {
  const errors: Partial<Record<ContactField, string>> = {};
  const name = draft.name.trim();
  const email = draft.email.trim();
  const company = draft.company.trim();
  const message = draft.message.trim();
  if (!name || name.length > CONTACT_LIMITS.name || CONTROL.test(name) || /[\r\n]/.test(name))
    errors.name = 'Ingresá un nombre válido de hasta 80 caracteres.';
  if (
    email.length < 3 ||
    email.length > CONTACT_LIMITS.email ||
    !EMAIL.test(email) ||
    CONTROL.test(email) ||
    /[\r\n]/.test(email)
  )
    errors.email = 'Ingresá un correo electrónico válido.';
  if (company.length > CONTACT_LIMITS.company || CONTROL.test(company) || /[\r\n]/.test(company))
    errors.company = 'La empresa puede tener hasta 120 caracteres.';
  if (!message || message.length > CONTACT_LIMITS.message || CONTROL.test(message))
    errors.message = 'Ingresá un mensaje de hasta 2000 caracteres.';
  return errors;
}

export function normalizedContactPayload(draft: ContactDraft) {
  return {
    submission_version: CONTACT_SUBMISSION_VERSION,
    name: draft.name.trim(),
    email: draft.email.trim(),
    company: draft.company.trim() || null,
    message: draft.message.trim(),
  };
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function parseInterviewContactFormPart(value: unknown): InterviewContactFormPart {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-contact-form');
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).sort().join(',') !== 'fields,form_version,intent,submission_version,type' ||
    raw['type'] !== 'interview_contact_form' ||
    raw['form_version'] !== CONTACT_FORM_VERSION ||
    raw['submission_version'] !== CONTACT_SUBMISSION_VERSION ||
    !['employment', 'interview', 'recruiting'].includes(String(raw['intent'])) ||
    !Array.isArray(raw['fields']) ||
    raw['fields'].length !== CONTACT_FIELDS.length ||
    !CONTACT_FIELDS.every((field, index) => (raw['fields'] as unknown[])[index] === field)
  )
    throw new Error('invalid-contact-form');
  return raw as InterviewContactFormPart;
}

export function parseContactSubmissionResponse(value: unknown): ContactSubmissionResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-contact-response');
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['outcome', 'retryable', 'request_id', 'field_errors']);
  if (
    Object.keys(raw).some((key) => !allowed.has(key)) ||
    !OUTCOMES.has(raw['outcome'] as ContactOutcome) ||
    typeof raw['retryable'] !== 'boolean' ||
    typeof raw['request_id'] !== 'string'
  )
    throw new Error('invalid-contact-response');
  const fieldErrors = raw['field_errors'];
  if (
    fieldErrors !== undefined &&
    (!fieldErrors ||
      typeof fieldErrors !== 'object' ||
      Array.isArray(fieldErrors) ||
      Object.keys(fieldErrors).some((key) => !CONTACT_FIELDS.includes(key as ContactField)))
  )
    throw new Error('invalid-contact-response');
  return raw as ContactSubmissionResponse;
}
