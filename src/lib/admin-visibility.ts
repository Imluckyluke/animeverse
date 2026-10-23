/** UI visibility only. Server admin endpoints must still validate ADMIN_KEY. */
export function canShowAdmin(user: { email: string } | null): boolean {
  return user?.email.trim().toLowerCase() === "hadighgh84@gmail.com";
}
