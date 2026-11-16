/*
 * Waitlist sign-up. Not wired to a backend yet: this only checks the address
 * and pretends to send it. Replace the body with a real request (e.g. a POST to
 * /api/waitlist) when there is somewhere to keep the emails.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string) {
  return EMAIL.test(value.trim());
}

export async function joinWaitlist(email: string): Promise<void> {
  if (!isEmail(email)) throw new Error("That doesn't look like an email");
  // TODO: send `email.trim().toLowerCase()` to the waitlist backend.
  await new Promise((resolve) => setTimeout(resolve, 400));
}
