// lib/validation/contact.ts
import { z } from 'zod'
import { personName, phoneField, NO_CONTROL } from './booking'

// Must match the <option> values on the contact page
export const CONTACT_SUBJECTS = ['reservation', 'rates', 'safari', 'group', 'other'] as const

export const contactSchema = z.strictObject({
  name: personName,
  email: z.string().trim().toLowerCase().max(254, 'Email address is too long.').pipe(z.email('Enter a valid email address.')),
  phone: phoneField,
  subject: z.enum(CONTACT_SUBJECTS, 'Choose a subject.'),
  message: z.string().trim().min(10, 'Please write a little more (at least 10 characters).').max(2000, 'Messages can be at most 2000 characters.').regex(NO_CONTROL, 'Your message contains characters we cannot accept.'),
  // Honeypot: real people never see this field, so a filled-in value means a bot (see contact page)
  website: z.string().max(200).optional(),
})
