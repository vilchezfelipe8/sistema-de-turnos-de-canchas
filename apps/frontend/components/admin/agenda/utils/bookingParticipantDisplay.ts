import type { Participant } from '../types/agendaTypes';

export function splitParticipantContactFields(contact: unknown) {
  const raw = String(contact || '').trim();
  if (!raw) return { phone: '', email: '' };

  if (raw.includes('·')) {
    const [phonePart, ...emailParts] = raw.split('·');
    return {
      phone: String(phonePart || '').replace(/\D/g, ''),
      email: emailParts.join('·').trim().toLowerCase(),
    };
  }

  const phoneLike = raw.replace(/[\d\s()+-]/g, '').length === 0;
  if (phoneLike) {
    return { phone: raw.replace(/\D/g, ''), email: '' };
  }

  if (raw.includes('@')) {
    return { phone: '', email: raw.toLowerCase() };
  }

  return { phone: '', email: raw.toLowerCase() };
}

export function extractEmailFromParticipantContact(contact: unknown) {
  return splitParticipantContactFields(contact).email;
}

export function extractPhoneFromParticipantContact(contact: unknown) {
  return splitParticipantContactFields(contact).phone;
}

export function buildParticipantContactFromFields(phone: unknown, email: unknown) {
  const safePhone = String(phone || '').trim();
  const safeEmail = String(email || '').trim().toLowerCase();
  if (safePhone && safeEmail) return `${safePhone} · ${safeEmail}`;
  return safePhone || safeEmail || '';
}

export function resolvePlaygroundClientPhone(owner?: Participant | null) {
  const fromContact = extractPhoneFromParticipantContact(owner?.contact);
  if (fromContact.length >= 8) {
    return fromContact.startsWith('54') ? `+${fromContact}` : `+54${fromContact}`;
  }

  return '';
}

export function resolvePlaygroundClientEmail(owner?: Participant | null) {
  return extractEmailFromParticipantContact(owner?.contact);
}

export function resolvePlaygroundClientDni(owner?: Participant | null) {
  return String(owner?.dni || '').trim();
}
