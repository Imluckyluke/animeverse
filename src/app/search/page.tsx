import { redirect } from "next/navigation";

/** Search lives inside the archive now — keep old links working. */
export default async function SearchPage({
  searchParams: pending,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await pending;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
  }
  const qs = params.toString();
  redirect(qs ? `/browse?${qs}` : "/browse");
}
