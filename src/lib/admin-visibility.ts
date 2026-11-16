/** Display rule only. Page and API authorization still require the real owner session. */
export function canShowAdmin(user: { email: string; id?: string; role?: string; localOnly?: boolean } | null): boolean {
  return user?.email.trim().toLowerCase() === "hadighgh84@gmail.com";
}
