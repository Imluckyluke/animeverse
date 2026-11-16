/** Public JSON contracts only: never import server credentials or private state. */
export type AdminRole = "owner" | "editor" | "reviewer";
export type AdminSession = { user: { id: string; name: string; email: string; role: AdminRole }; csrf: string; expiresAt: string };
export type AdminMutation = { ok: true; revision?: number; eventId?: number; commandId?: string; state?: string };
export type AdminEvent = { id: number; actor: string; action: string; target: string; at: string; reversible: boolean; summary: string };
export type AdminCommand = { id: string; kind: string; state: "pending" | "running" | "applied" | "failed"; createdAt: string; finishedAt?: string; error?: string };
export type AdminOverview = {
  serverNow: string;
  inventory: { titles: number; episodes: number; qualities: number; copied: number; pending: number; unmatched: number; held: number };
  services: { name: string; label: string; state: string; updatedAt?: string }[];
  publication: { state: string; publishedAt?: string; catalogCount?: number; lastError?: string; pendingChanges: number };
  cache: { states: Record<string, number>; bytes: { hot: number; temp: number }; active: number; capacity: number };
  accounts: { total: number; favorites: number; disabled: number };
  activity: AdminEvent[];
  commands: AdminCommand[];
};
export type AdminTitle = {
  slug: string; key: string; title: string; titleEn: string; titleJa: string; year: number | null;
  type: string; format: string; status: string; cover: string; banner: string; studio: string;
  synopsis: string; genres: string[]; readyEpisodes: number; readyQualities: number;
  declaredEpisodes: number | null; hidden: boolean; pinned: boolean; revision: number;
  source: string; metadataUrl?: string; updatedAt?: string; published: boolean;
  editorScore?: number | null;
};
export type AdminEpisode = { number: number; qualities: { label: string; url: string; size: number | null; hidden: boolean; fileId: number | null }[] };
export type AdminTitleDetail = { item: AdminTitle; episodes: AdminEpisode[]; revision: number };
export type AdminCatalogPage = { items: AdminTitle[]; total: number; page: number; pageSize: number };
export type AdminTitlePatch = Partial<Pick<AdminTitle, "title" | "titleEn" | "titleJa" | "year" | "studio" | "synopsis" | "genres" | "hidden" | "pinned" | "editorScore">> & { cover?: string; banner?: string };
export type AdminReviewFile = { id: number; title: string; filename: string; episode: number | null; season: number | null; quality: string; size: number | null; status: string; reason: string; destinationUrl: string; candidates: { id: number; title: string; year: number | null }[] };
export type AdminReviewPage = { items: AdminReviewFile[]; total: number; page: number; pageSize: number; refreshedAt: string | null; refreshing: boolean };
export type AdminReviewInput = { fileId: number; targetSlug: string; episode: number; quality: string; note: string; replaceExisting?: boolean };
export type AdminReviewPreview = { id: string; expiresAt: string; valid: boolean; source: AdminReviewFile; target: AdminTitle; episode: number; quality: string; warnings: string[]; errors: string[] };
export type AdminUser = { id: string; name: string; email: string; role: string; disabled: boolean; createdAt: string; lastLoginAt: string | null; favorites: number };
export type AdminHistoryPage = { items: AdminEvent[]; total: number; page: number; pageSize: number };
export type AdminSettings = { publicationMode: "manual" | "automatic"; revision: number; limits: { workerCount: number; activeJobs: number; tempBytes: number; hotBytes: number }; adminEmail: string };
export type AdminPostPreview = {
  id: string; state: "preview_pending" | "preview_ready" | "import_pending" | "importing" | "imported" | "failed";
  expiresAt: number; error: string; warnings?: string[]; message?: string;
  items?: { postId: number; postUrl: string; slug: string; title: string; titleEn: string;
    titleOriginal: string; year: number | null; format: string; synopsis: string; cover: string;
    genres: string[]; episodes: { number: number; qualities: string[] }[]; existing: boolean; fileCount: number }[];
};
